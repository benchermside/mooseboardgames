// Spikes S2 and S4: launch the spike game server on Fargate and time each
// step from RunTask until the match answers through CloudFront.
//
// Usage (from spikes/):
//   node aws/launch-and-measure.js [--runs 5] [--keep] [--label alpine]
//
//   --runs N   launch N tasks one after another and summarize
//   --keep     leave the (last) task running, for S1. Stop it yourself after.
//   --label X  tag the results, e.g. with the base image being tried
//   --config F config file, relative to aws/ (default config.json)
//
// Reads aws/config.json (copy config.example.json). Uses your AWS CLI
// credentials. Appends one JSON line per run to aws/timings.jsonl.
//
// To run against the real dev environment (design T5a), write its config
// from Terraform and pass --config config.dev.json:
//   terraform "-chdir=../infra/envs/dev" output -raw launch_config | Out-File -Encoding ascii aws/config.dev.json
// (The quotes stop Windows PowerShell splitting the -chdir argument at the dot.)
// That config sets "recordSchema": "real", so the match record uses the real
// matches table's attributes (match_id, status, origin_host, task_arn).
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DeleteItemCommand, DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { DescribeNetworkInterfacesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeTasksCommand, ECSClient, RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';

const { values: args } = parseArgs({
    options: {
        runs: { type: 'string', default: '1' },
        keep: { type: 'boolean', default: false },
        label: { type: 'string', default: '' },
        config: { type: 'string', default: 'config.json' },
    },
});
const configURL = new URL(`./${args.config}`, import.meta.url);
// Strip a byte-order mark, which PowerShell may add when writing the file.
const config = JSON.parse(readFileSync(configURL, 'utf8').replace(/^\uFEFF/, ''));
const ecs = new ECSClient({ region: config.region });
const ec2 = new EC2Client({ region: config.region });
const dynamo = new DynamoDBClient({ region: config.region });

const POLL_MS = 250;
const READY_TIMEOUT_MS = 5 * 60_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The spike's table and the real matches table name their attributes differently.
const realSchema = config.recordSchema === 'real';
const matchKey = matchID => (realSchema ? { match_id: { S: matchID } } : { matchID: { S: matchID } });
function matchRecord(matchID, originHost, taskArn) {
    if (realSchema) {
        // The router only routes READY and IN_PROGRESS matches.
        return {
            ...matchKey(matchID),
            status: { S: 'READY' },
            origin_host: { S: originHost },
            task_arn: { S: taskArn },
        };
    }
    return { ...matchKey(matchID), originHost: { S: originHost }, taskArn: { S: taskArn } };
}

/** Launch one task and return its timings, in seconds since RunTask was sent. */
async function launchOnce(keep) {
    const matchID = `spike-${Date.now().toString(36)}`;
    const t0 = performance.now();
    const since = () => Number(((performance.now() - t0) / 1000).toFixed(2));
    const timings = {};
    const mark = (name, detail = '') => {
        if (timings[name] === undefined) {
            timings[name] = since();
            console.log(`  +${timings[name].toFixed(2)}s  ${name} ${detail}`);
        }
    };

    console.log(`\nLaunching match ${matchID}`);
    const run = await ecs.send(new RunTaskCommand({
        cluster: config.cluster,
        taskDefinition: config.taskDefinition,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: config.subnets,
                securityGroups: [config.securityGroup],
                assignPublicIp: 'ENABLED',
            },
        },
        overrides: {
            containerOverrides: [{
                name: config.containerName,
                environment: [{ name: 'MATCH_ID', value: matchID }],
            }],
        },
        tags: [{ key: 'matchID', value: matchID }],
    }));
    if (run.failures?.length) {
        throw new Error(`RunTask failed: ${JSON.stringify(run.failures)}`);
    }
    const taskArn = run.tasks[0].taskArn;
    mark('runTaskReturned');

    // Watch the task's status and its network interface's public DNS name
    // at the same time, until both the task is RUNNING and the name is known.
    let eniID;
    let originHost;
    let publicIp;
    let lastStatus;
    while (timings.running === undefined || originHost === undefined) {
        const { tasks } = await ecs.send(new DescribeTasksCommand({ cluster: config.cluster, tasks: [taskArn] }));
        const task = tasks[0];
        if (task.lastStatus !== lastStatus) {
            lastStatus = task.lastStatus;
            mark(`status:${lastStatus}`);
        }
        if (lastStatus === 'RUNNING') {
            mark('running');
        }
        if (lastStatus === 'STOPPED') {
            throw new Error(`Task stopped early: ${task.stoppedReason}`);
        }
        eniID ??= task.attachments
            ?.find(a => a.type === 'ElasticNetworkInterface')
            ?.details?.find(d => d.name === 'networkInterfaceId')?.value;
        if (eniID !== undefined && originHost === undefined) {
            mark('eniKnown', eniID);
            const { NetworkInterfaces } = await ec2.send(
                new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniID] }));
            const association = NetworkInterfaces?.[0]?.Association;
            if (association?.PublicIp) {
                publicIp = association.PublicIp;
                mark('publicIpKnown', publicIp);
            }
            if (association?.PublicDnsName) {
                originHost = association.PublicDnsName;
                mark('publicDnsKnown', originHost);
            }
        }
        await sleep(POLL_MS);
    }

    // What the task-state Lambda will do: record the origin for the router.
    await dynamo.send(new PutItemCommand({
        TableName: config.table,
        Item: matchRecord(matchID, originHost, taskArn),
    }));
    mark('originWritten');

    // READY: the container answers through CloudFront and Lambda@Edge.
    const healthURL = `https://${config.cloudFrontDomain}/m/${matchID}/healthz`;
    let lastAnswer;
    while (timings.ready === undefined) {
        if (since() * 1000 > READY_TIMEOUT_MS) {
            throw new Error(`Not ready after ${READY_TIMEOUT_MS / 1000}s; last answer: ${lastAnswer}`);
        }
        try {
            const response = await fetch(healthURL);
            lastAnswer = `${response.status}`;
            if (response.ok) {
                mark('ready', `(${healthURL})`);
            }
        } catch (err) {
            lastAnswer = err.message;
        }
        if (timings.ready === undefined) {
            await sleep(500);
        }
    }

    const result = {
        when: new Date().toISOString(),
        label: args.label,
        matchID,
        taskArn,
        originHost,
        publicIp,
        timings,
        dnsAfterRunningSeconds: Number((timings.publicDnsKnown - timings.running).toFixed(2)),
    };
    appendFileSync(new URL('./timings.jsonl', import.meta.url), JSON.stringify(result) + '\n');

    if (keep) {
        console.log(`\n  Task left running for S1. Next:`);
        console.log(`    node client/ws-client.js --url https://${config.cloudFrontDomain} --match ${matchID} --idle-minutes 20`);
        console.log(`  Then stop it: ECS console > ${config.cluster} > Tasks > select > Stop.`);
    } else {
        await ecs.send(new StopTaskCommand({ cluster: config.cluster, task: taskArn, reason: 'spike run finished' }));
        await dynamo.send(new DeleteItemCommand({ TableName: config.table, Key: matchKey(matchID) }));
        console.log('  Task stopped.');
    }
    return result;
}

function summarize(results) {
    const steps = ['running', 'publicDnsKnown', 'ready'];
    console.log(`\nSummary over ${results.length} run(s), seconds after RunTask:`);
    console.log('  step              min     median  max');
    for (const step of steps) {
        const values = results.map(r => r.timings[step]).sort((a, b) => a - b);
        const median = values[Math.floor(values.length / 2)];
        console.log(`  ${step.padEnd(16)}  ${values[0].toFixed(2).padStart(6)}  ${median.toFixed(2).padStart(6)}  ${values.at(-1).toFixed(2).padStart(6)}`);
    }
    const dnsLags = results.map(r => r.dnsAfterRunningSeconds);
    console.log(`  public DNS vs RUNNING (negative = known before RUNNING): ${dnsLags.join(', ')}`);
}

const runs = Number(args.runs);
const results = [];
for (let i = 0; i < runs; i++) {
    results.push(await launchOnce(args.keep && i === runs - 1));
}
summarize(results);

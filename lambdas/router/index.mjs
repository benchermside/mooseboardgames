// Lambda@Edge origin-request router for game connections (design T5).
//
// Sends /m/<matchID>/... to the Fargate task hosting that match, by looking
// the match up in the matches table. See documentation/fargate-host-design.md,
// "Connection path".
//
// Lambda@Edge has no environment variables, so Terraform writes config.json
// next to this file when it builds the zip (infra/modules/game_host/router.tf).
// Edge functions run in many regions, so the table's region is explicit.
import { readFileSync } from 'node:fs';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const { table, tableRegion, originPort } = config;

// Only these statuses have a task that should be accepting connections.
const ROUTABLE = new Set(['READY', 'IN_PROGRESS']);

const dynamo = new DynamoDBClient({ region: tableRegion });

// matchID -> origin host. Once set, a match's origin never changes, so hits
// are kept for the life of this function instance. Misses are never kept.
const originCache = new Map();

function respond(status, statusDescription, message) {
    return {
        status: String(status),
        statusDescription,
        headers: {
            'content-type': [{ key: 'Content-Type', value: 'text/plain' }],
            'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
        },
        body: message,
    };
}

export const handler = async (event) => {
    const request = event.Records[0].cf.request;
    const match = request.uri.match(/^\/m\/([A-Za-z0-9_-]{1,64})\//);
    if (!match) {
        return respond(404, 'Not Found', 'No match ID in path');
    }
    const matchID = match[1];

    let host = originCache.get(matchID);
    const cached = host !== undefined;
    if (!cached) {
        const { Item } = await dynamo.send(new GetItemCommand({
            TableName: table,
            Key: { match_id: { S: matchID } },
            ProjectionExpression: '#s, origin_host',
            ExpressionAttributeNames: { '#s': 'status' },
            ConsistentRead: true,
        }));
        if (Item === undefined) {
            console.log(JSON.stringify({ matchID, result: 'not found' }));
            return respond(404, 'Not Found', 'No such match');
        }
        const status = Item.status?.S;
        host = Item.origin_host?.S;
        if (!ROUTABLE.has(status) || host === undefined) {
            console.log(JSON.stringify({ matchID, result: 'not routable', status }));
            return respond(503, 'Service Unavailable', `Match is ${status ?? 'not ready'}`);
        }
        originCache.set(matchID, host);
    }
    console.log(JSON.stringify({ matchID, host, cached, uri: request.uri }));

    request.origin = {
        custom: {
            domainName: host,
            port: originPort,
            protocol: 'http',
            path: '',
            sslProtocols: ['TLSv1.2'],
            readTimeout: 30,
            keepaliveTimeout: 5,
            customHeaders: {},
        },
    };
    request.headers.host = [{ key: 'Host', value: host }];
    return request;
};

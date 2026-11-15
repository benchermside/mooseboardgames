// Lambda@Edge origin-request router (spike S1).
//
// Sends /m/<matchID>/... to the Fargate task hosting that match, by looking
// the match up in DynamoDB. Lambda@Edge has no environment variables, so the
// settings are constants here. Edge functions run in many regions, so the
// table's region is explicit.
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const TABLE = 'mbg-spike-matches';
const TABLE_REGION = 'us-east-1';
const ORIGIN_PORT = 8000;

const dynamo = new DynamoDBClient({ region: TABLE_REGION });

// matchID -> origin host. Once set, a match's origin never changes, so hits
// are kept for the life of this function instance. Misses are not kept.
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
            TableName: TABLE,
            Key: { matchID: { S: matchID } },
            ConsistentRead: true,
        }));
        host = Item?.originHost?.S;
        if (host === undefined) {
            console.log(JSON.stringify({ matchID, result: 'not found' }));
            return respond(404, 'Not Found', 'No such match');
        }
        originCache.set(matchID, host);
    }
    console.log(JSON.stringify({ matchID, host, cached, uri: request.uri }));

    request.origin = {
        custom: {
            domainName: host,
            port: ORIGIN_PORT,
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

// Write a match record the way the lobby will, for trying the server by hand.
//
// Usage (from the repo root):
//   npm run create-match -w game-server -- [--local] [--game ur] [--players 2]
//       [--match <id>] [--table mooseboardgames-matches-dev]
//
//   --local  use DynamoDB Local (from `just dev`) at http://localhost:8000
//            instead of AWS
//
// Prints the match ID and each seat's credential.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const { values: args } = parseArgs({
    options: {
        local: { type: 'boolean', default: false },
        game: { type: 'string', default: 'ur' },
        players: { type: 'string', default: '2' },
        match: { type: 'string', default: `m_${randomBytes(6).toString('hex')}` },
        table: { type: 'string', default: 'mooseboardgames-matches-dev' },
    },
});

const endpoint = args.local ? 'http://localhost:8000' : undefined;
// DynamoDB Local accepts any credentials, but the SDK insists on having some.
const credentials = args.local ? { accessKeyId: 'local', secretAccessKey: 'local' } : undefined;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1', endpoint, credentials }));

const numPlayers = Number(args.players);
const seatCredentials = Object.fromEntries(
    Array.from({ length: numPlayers }, (_, seat) => [String(seat), randomBytes(16).toString('base64url')]));
const now = new Date().toISOString();

await client.send(new PutCommand({
    TableName: args.table,
    Item: {
        match_id: args.match,
        status: 'CREATED',
        game_name: args.game,
        num_players: numPlayers,
        credentials: seatCredentials,
        created_at: now,
        updated_at: now,
    },
}));

console.log(`Wrote match ${args.match} (${args.game}, ${numPlayers} players) to ${args.table}${args.local ? ' on DynamoDB Local' : ''}.`);
for (const [seat, credential] of Object.entries(seatCredentials)) {
    console.log(`  seat ${seat}: ${credential}`);
}

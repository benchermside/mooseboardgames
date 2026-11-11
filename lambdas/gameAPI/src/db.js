// DynamoDB access for the gameAPI Lambda.
//
// Everything that talks to DynamoDB is in this file, so the tests can swap in
// an in-memory version with the same methods (see test/fakeDb.js).
//
// Game state, initial state and metadata are stored as JSON strings, so that
// boardgame.io's state never has to fit DynamoDB's type rules.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    DeleteCommand,
    GetCommand,
    PutCommand,
    QueryCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const MATCHES_TABLE = process.env.MATCHES_TABLE ?? 'mooseboardgames-matches-dev';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE ?? 'mooseboardgames-game-connections-dev';
const CONNECTIONS_BY_MATCH_INDEX = 'match_id-index';

/** True if err is DynamoDB refusing a write because its condition was false. */
export function isConditionFailure(err) {
    return err?.name === 'ConditionalCheckFailedException';
}

/**
 * Create the real DynamoDB-backed db. Honors AWS_REGION and
 * DYNAMODB_ENDPOINT_URL, like the Python siteAPI, so it can point at
 * DynamoDB Local.
 */
export function createDynamoDb() {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
        endpoint: process.env.DYNAMODB_ENDPOINT_URL,
    }));

    return {
        /** The match row, or undefined if there is none. */
        async getMatch(matchID) {
            const response = await client.send(new GetCommand({
                TableName: MATCHES_TABLE,
                Key: { match_id: matchID },
            }));
            return response.Item;
        },

        /**
         * Store a new game's first state on a match row the lobby already
         * created. Fails (condition failure) if the row is missing or another
         * request already stored a state.
         */
        async createMatchState(matchID, { stateJSON, stateID, initialStateJSON, metadataJSON }) {
            await client.send(new UpdateCommand({
                TableName: MATCHES_TABLE,
                Key: { match_id: matchID },
                UpdateExpression: 'SET #state = :state, state_id = :state_id, initial_state = :initial_state, metadata = :metadata',
                ConditionExpression: 'attribute_exists(match_id) AND attribute_not_exists(#state)',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: {
                    ':state': stateJSON,
                    ':state_id': stateID,
                    ':initial_state': initialStateJSON,
                    ':metadata': metadataJSON,
                },
            }));
        },

        /**
         * Replace the game state. Fails (condition failure) unless the stored
         * state_id is still expectedStateID, so of two moves made at the same
         * moment only one is saved.
         */
        async setMatchState(matchID, { stateJSON, stateID }, expectedStateID) {
            await client.send(new UpdateCommand({
                TableName: MATCHES_TABLE,
                Key: { match_id: matchID },
                UpdateExpression: 'SET #state = :state, state_id = :state_id',
                ConditionExpression: 'state_id = :expected',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: {
                    ':state': stateJSON,
                    ':state_id': stateID,
                    ':expected': expectedStateID,
                },
            }));
        },

        async setMatchMetadata(matchID, metadataJSON) {
            await client.send(new UpdateCommand({
                TableName: MATCHES_TABLE,
                Key: { match_id: matchID },
                UpdateExpression: 'SET metadata = :metadata',
                ConditionExpression: 'attribute_exists(match_id)',
                ExpressionAttributeValues: { ':metadata': metadataJSON },
            }));
        },

        async putConnection(connection) {
            await client.send(new PutCommand({ TableName: CONNECTIONS_TABLE, Item: connection }));
        },

        /** The connection row, or undefined if there is none. */
        async getConnection(connectionID) {
            const response = await client.send(new GetCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connection_id: connectionID },
            }));
            return response.Item;
        },

        async deleteConnection(connectionID) {
            await client.send(new DeleteCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connection_id: connectionID },
            }));
        },

        /** Every connection row for a match. */
        async connectionsForMatch(matchID) {
            const connections = [];
            let startKey;
            do {
                const response = await client.send(new QueryCommand({
                    TableName: CONNECTIONS_TABLE,
                    IndexName: CONNECTIONS_BY_MATCH_INDEX,
                    KeyConditionExpression: 'match_id = :match_id',
                    ExpressionAttributeValues: { ':match_id': matchID },
                    ExclusiveStartKey: startKey,
                }));
                connections.push(...response.Items);
                startKey = response.LastEvaluatedKey;
            } while (startKey);
            return connections;
        },
    };
}

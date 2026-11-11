// In-memory stand-ins for DynamoDB (src/db.js) and for sending to browsers,
// so the handler can be tested with no AWS.

function conditionFailure() {
    const err = new Error('The conditional request failed');
    err.name = 'ConditionalCheckFailedException';
    return err;
}

const copy = (item) => (item === undefined ? undefined : structuredClone(item));

/** Same methods and condition rules as createDynamoDb() in src/db.js. */
export function createFakeDb() {
    const matches = new Map();
    const connections = new Map();
    return {
        matches,
        connections,
        // Tests can set this to run code just before setMatchState checks
        // its condition, e.g. to pretend another move was saved first.
        beforeSetMatchState: undefined,

        async getMatch(matchID) {
            return copy(matches.get(matchID));
        },
        async createMatchState(matchID, { stateJSON, stateID, initialStateJSON, metadataJSON }) {
            const match = matches.get(matchID);
            if (match === undefined || match.state !== undefined) {
                throw conditionFailure();
            }
            Object.assign(match, {
                state: stateJSON,
                state_id: stateID,
                initial_state: initialStateJSON,
                metadata: metadataJSON,
            });
        },
        async setMatchState(matchID, { stateJSON, stateID }, expectedStateID) {
            await this.beforeSetMatchState?.(matchID);
            const match = matches.get(matchID);
            if (match === undefined || match.state_id !== expectedStateID) {
                throw conditionFailure();
            }
            Object.assign(match, { state: stateJSON, state_id: stateID });
        },
        async setMatchMetadata(matchID, metadataJSON) {
            const match = matches.get(matchID);
            if (match === undefined) {
                throw conditionFailure();
            }
            match.metadata = metadataJSON;
        },
        async putConnection(connection) {
            connections.set(connection.connection_id, copy(connection));
        },
        async getConnection(connectionID) {
            return copy(connections.get(connectionID));
        },
        async deleteConnection(connectionID) {
            connections.delete(connectionID);
        },
        async connectionsForMatch(matchID) {
            return [...connections.values()].filter(c => c.match_id === matchID).map(copy);
        },
    };
}

/**
 * Stand-in for createPost: records what each connection was sent, in
 * `sent[connectionID]`. Connections listed in `gone` fail the way API Gateway
 * does for a closed connection.
 */
export function createFakePost() {
    const sent = {};
    const gone = new Set();
    const makePost = () => async (connectionID, data) => {
        if (gone.has(connectionID)) {
            const err = new Error('Gone');
            err.name = 'GoneException';
            throw err;
        }
        // Round-trip through JSON, like the real WebSocket.
        (sent[connectionID] ??= []).push(JSON.parse(JSON.stringify(data)));
    };
    return { sent, gone, makePost };
}

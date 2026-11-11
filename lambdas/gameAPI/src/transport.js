// Sending messages from boardgame.io's Master to browsers through API Gateway.
import {
    ApiGatewayManagementApiClient,
    PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

/** True if err means the browser's connection no longer exists. */
function isGoneConnection(err) {
    return err?.name === 'GoneException' || err?.$metadata?.httpStatusCode === 410;
}

const _clients = new Map();

/**
 * Return a function post(connectionID, data) that sends data, as JSON, to one
 * browser connection through the WebSocket API's management endpoint
 * (https://{domain}/{stage}).
 */
export function createPost(endpoint) {
    let client = _clients.get(endpoint);
    if (client === undefined) {
        client = new ApiGatewayManagementApiClient({ endpoint });
        _clients.set(endpoint, client);
    }
    return async (connectionID, data) => {
        await client.send(new PostToConnectionCommand({
            ConnectionId: connectionID,
            Data: JSON.stringify(data),
        }));
    };
}

/**
 * boardgame.io transport for Master that holds every message until flush().
 *
 * Master sends its messages without waiting, and sends a move's update BEFORE
 * saving it. Holding them means nothing goes out unless the whole call
 * succeeded, and the Lambda can wait for every send before it returns.
 */
export class BufferedTransport {
    /**
     * connection: the connection row of the browser this invocation serves.
     * filterPlayerView: from boardgame.io's getFilterPlayerView(game); turns a
     *   message into what one player is allowed to see, in the shape the
     *   boardgame.io client expects.
     */
    constructor({ connection, filterPlayerView, db, post }) {
        this.connection = connection;
        this.filterPlayerView = filterPlayerView;
        this.db = db;
        this.post = post;
        this.outbox = [];
    }

    /** Master calls this for a message to one player: always the requester here. */
    send({ playerID, ...data }) {
        this.outbox.push({ toEveryone: false, data });
    }

    /** Master calls this for a message to everyone in the match. */
    sendAll(data) {
        this.outbox.push({ toEveryone: true, data });
    }

    /** Send everything held, in order. Deletes connections that have gone away. */
    async flush() {
        const outbox = this.outbox;
        this.outbox = [];
        let everyone;
        for (const { toEveryone, data } of outbox) {
            let recipients;
            if (toEveryone) {
                everyone ??= await this.db.connectionsForMatch(this.connection.match_id);
                recipients = everyone;
            } else {
                recipients = [this.connection];
            }
            await Promise.all(recipients.map(recipient => this._sendTo(recipient, data)));
        }
    }

    async _sendTo(recipient, data) {
        const filtered = this.filterPlayerView(recipient.player_id, data);
        try {
            await this.post(recipient.connection_id, filtered);
        } catch (err) {
            if (!isGoneConnection(err)) {
                throw err;
            }
            await this.db.deleteConnection(recipient.connection_id);
        }
    }
}

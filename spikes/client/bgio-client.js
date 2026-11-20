// Helpers for driving a boardgame.io client from Node, the same way the
// browser will: SocketIO transport, websocket only, per-match path.
import { Client } from 'boardgame.io/dist/cjs/client.js';
import { SocketIO } from 'boardgame.io/dist/cjs/multiplayer.js';

/**
 * Make and start a client.
 *
 * server: e.g. "http://localhost:8001" or "https://dXXXX.cloudfront.net"
 * socketPathMode: "path" or "query" (see server/server.js)
 * pathMatchID: the match ID to put in the socket path or query. Normally the
 *   same as matchID; S3 sets it differently to check stray connections fail.
 */
export function startClient({
    server,
    game,
    matchID,
    playerID,
    credentials,
    socketPathMode = 'path',
    pathMatchID = matchID,
}) {
    const socketOpts = {
        transports: ['websocket'],
        reconnection: false,
        // Node's WebSocket sends no User-Agent, and the site's WAF (AWS managed
        // common rule set, NoUserAgent_HEADER) blocks requests without one.
        // Browsers always send one, so this only matters for Node clients.
        extraHeaders: { 'User-Agent': 'mooseboardgames-spike-client' },
    };
    if (socketPathMode === 'path') {
        socketOpts.path = `/m/${pathMatchID}/socket.io`;
    } else {
        socketOpts.query = { matchID: pathMatchID };
    }
    const client = Client({
        game,
        matchID,
        playerID,
        credentials,
        multiplayer: SocketIO({ server, socketOpts }),
    });
    client.start();
    return client;
}

/** The client's underlying socket.io socket. */
export function socketOf(client) {
    return client.transport.socket;
}

/** True once the server has answered the client's sync (so it was let in). */
export function isSynced(client) {
    return client.matchData !== undefined;
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Resolve true when check() is true, or false after timeoutMs. */
export async function waitFor(check, timeoutMs = 3000, intervalMs = 25) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (check()) {
            return true;
        }
        await sleep(intervalMs);
    }
    return check();
}

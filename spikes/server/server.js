// A boardgame.io server that hosts exactly one match, the way a Fargate task
// will. main.js runs it from environment variables; s3/run-s3.js runs it
// in-process.
import { Server, SocketIO } from 'boardgame.io/dist/cjs/server.js';
import { ActivityStorage } from './activity-storage.js';
import { seedMatch } from './seed.js';

/** Elapsed time since the process started, for the timing logs. */
export function log(message) {
    const uptime = (performance.now() / 1000).toFixed(3);
    console.log(`${new Date().toISOString()} [+${uptime}s] ${message}`);
}

/**
 * Start the server and resolve once it is listening.
 *
 * socketPathMode:
 *   "path"  - Socket.IO is served at /m/<matchID>/socket.io (the design's plan).
 *   "query" - Socket.IO is served at the default /socket.io and the client
 *             must send ?matchID=<matchID> (the design's fallback).
 * port: 0 picks a free port.
 */
export async function startServer({
    game,
    matchID,
    credentials,
    port = 8000,
    socketPathMode = 'path',
    onActivity,
    onGameOver,
}) {
    let socketOpts;
    if (socketPathMode === 'path') {
        socketOpts = { path: `/m/${matchID}/socket.io`, transports: ['websocket'] };
    } else if (socketPathMode === 'query') {
        socketOpts = {
            transports: ['websocket'],
            allowRequest: (req, callback) => {
                const asked = new URL(req.url, 'http://unused').searchParams.get('matchID');
                callback(null, asked === matchID);
            },
        };
    } else {
        throw new Error(`Unknown socketPathMode: ${socketPathMode}`);
    }

    // boardgame.io doesn't export its InMemory class, but Server() makes one
    // when it isn't given a db. Borrow it from a server that is never run.
    const inner = Server({ games: [], origins: [] }).db;
    const storage = new ActivityStorage(inner, { onActivity, onGameOver });

    const server = Server({
        games: [game],
        db: storage,
        transport: new SocketIO({ socketOpts }),
        origins: [],
    });

    // Runs before boardgame.io's own routes. Answer the health check, and
    // hide boardgame.io's Lobby API: in this design, the lobby lives elsewhere.
    // (Socket.IO requests never reach Koa.)
    const healthPath = `/m/${matchID}/healthz`;
    server.app.use(async (ctx) => {
        if (ctx.method === 'GET' && ctx.path === healthPath) {
            ctx.body = { matchID, status: 'ok' };
        } else {
            ctx.status = 404;
        }
    });

    await seedMatch(storage, game, matchID, credentials);
    const servers = await server.run(port);
    return {
        port: servers.appServer.address().port,
        storage,
        stop: () => server.kill(servers),
    };
}

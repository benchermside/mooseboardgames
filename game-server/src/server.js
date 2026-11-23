// A boardgame.io server that hosts exactly one match.
import { Server, SocketIO } from 'boardgame.io/dist/cjs/server.js';
import { ActivityStorage } from './activity-storage.js';
import { seedMatch } from './seed.js';

/** The per-match path prefix. CloudFront's /m/* behavior routes it to this task. */
export const matchPathPrefix = matchID => `/m/${matchID}`;

/**
 * Start the server for one match and resolve once it is listening.
 *
 * Socket.IO is served at /m/<matchID>/socket.io, so a connection meant for
 * another match is refused here even if it somehow reached this task.
 *
 * match: what parseMatchRecord returns.
 * port: 0 picks a free port (for tests).
 */
export async function startServer({ game, matchID, match, port = 8000 }) {
    const prefix = matchPathPrefix(matchID);
    const socketOpts = { path: `${prefix}/socket.io`, transports: ['websocket'] };

    // boardgame.io doesn't export its InMemory class, but Server() makes one
    // when it isn't given a db. Borrow it from a server that is never run.
    const inner = Server({ games: [], origins: [] }).db;
    const storage = new ActivityStorage(inner);

    const server = Server({
        games: [game],
        db: storage,
        transport: new SocketIO({ socketOpts }),
        // Players connect through the site's own host, so there is no
        // cross-origin access to allow.
        origins: [],
    });

    // Runs before boardgame.io's own routes. Answer the health check, and
    // hide boardgame.io's Lobby API: the site's lobby replaces it.
    // (Socket.IO requests never reach Koa.)
    const healthPath = `${prefix}/healthz`;
    server.app.use(async (ctx) => {
        if (ctx.method === 'GET' && ctx.path === healthPath) {
            ctx.body = { matchID, status: 'ok' };
        } else {
            ctx.status = 404;
        }
    });

    await seedMatch(storage, game, matchID, match);
    const servers = await server.run(port);
    return {
        port: servers.appServer.address().port,
        storage,
        stop: () => server.kill(servers),
    };
}

// Design T6: load the match record, start the server for it, and tell the
// rest of the system it's listening. Then hand over to the lifecycle (T7, T8),
// which decides when the match is over.
import { MatchLifecycle } from './lifecycle.js';
import { log } from './log.js';
import { parseMatchRecord, TERMINAL_STATUSES } from './match-record.js';
import { startServer } from './server.js';

/**
 * table: something with load, markListening and setStatus, normally a MatchTable.
 * timeouts: overrides for lifecycle.js's DEFAULT_TIMEOUTS. idleMs and
 *   maxLifetimeMs default to the game's own (games.js).
 * exit(code): called when the match is over and the server has stopped.
 * startedAt: milliseconds since the epoch the maximum lifetime counts from.
 *
 * Resolves to one of:
 *   { outcome: 'listening', match, port, storage, stop, lifecycle }
 *   { outcome: 'already-over', status }  the match ended before we started;
 *                                         nothing is left running.
 * Throws if the record is missing or malformed, or DynamoDB fails.
 */
export async function hostMatch({ matchID, table, games, port, timeouts, exit, startedAt = performance.timeOrigin }) {
    const item = await table.load(matchID);
    if (item !== undefined && TERMINAL_STATUSES.includes(item.status)) {
        return { outcome: 'already-over', status: item.status };
    }
    const match = parseMatchRecord(matchID, item, games);
    log(`MATCH ${matchID}: ${match.gameName}, ${match.numPlayers} players, status ${match.status}`);

    const server = await startServer({ game: match.game, matchID, match, port });

    // The lifetime counts from startedAt: by default, when the process (so,
    // roughly, the task) started.
    const matchTimeouts = { idleMs: match.idleTimeoutMs, maxLifetimeMs: match.maxLifetimeMs, ...timeouts };
    const expiresAt = new Date(startedAt + matchTimeouts.maxLifetimeMs);

    // Checked again here, because the lobby can cancel while we start up.
    if (!(await table.markListening(matchID, { expiresAt }))) {
        server.stop();
        const latest = await table.load(matchID);
        return { outcome: 'already-over', status: latest?.status ?? 'DELETED' };
    }

    const lifecycle = new MatchLifecycle({
        matchID,
        numPlayers: match.numPlayers,
        table,
        storage: server.storage,
        stopServer: server.stop,
        exit,
        timeouts: matchTimeouts,
        expiresAt,
    });
    lifecycle.start();
    return { outcome: 'listening', match, ...server, lifecycle };
}

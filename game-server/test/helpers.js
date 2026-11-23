// Test helpers: a tiny game, a fake match table, and a boardgame.io client
// driven from Node the same way the browser will connect.
import { Client } from 'boardgame.io/dist/cjs/client.js';
import { SocketIO } from 'boardgame.io/dist/cjs/multiplayer.js';

/** A two-player game that ends after three moves. setup_data can set the starting count. */
export const Tally = {
    name: 'tally',
    minPlayers: 2,
    maxPlayers: 4,
    setup: (_, setupData) => ({ count: setupData?.start ?? 0 }),
    moves: {
        bump: ({ G }) => {
            G.count += 1;
        },
    },
    endIf: ({ G }) => (G.count >= 3 ? { winner: '0' } : undefined),
};

/** Like games.js's GAMES. Tally's timeouts are short, for the lifecycle tests. */
export const TALLY_IDLE_TIMEOUT_MS = 400;
export const TALLY_MAX_LIFETIME_MS = 60_000;
export const TEST_GAMES = {
    tally: { game: Tally, idleTimeoutMs: TALLY_IDLE_TIMEOUT_MS, maxLifetimeMs: TALLY_MAX_LIFETIME_MS },
};

export const CREDENTIALS = { 0: 'secret0', 1: 'secret1' };

/** A valid record, as the lobby writes it. */
export function sampleRecord(overrides = {}) {
    return {
        match_id: 'm_test',
        status: 'CREATED',
        game_name: 'tally',
        num_players: 2,
        credentials: { ...CREDENTIALS },
        ...overrides,
    };
}

/** Stands in for MatchTable, holding records in memory. */
export class FakeMatchTable {
    constructor(records = {}) {
        this.records = records;
        // Lets a test change the record between load() and markListening().
        this.beforeMarkListening = () => {};
    }

    async load(matchID) {
        return this.records[matchID] && structuredClone(this.records[matchID]);
    }

    async markListening(matchID, { expiresAt }) {
        this.beforeMarkListening();
        return this.#updateUnlessOver(matchID, { listening: true, expires_at: expiresAt.toISOString() });
    }

    async setStatus(matchID, status, { result } = {}) {
        return this.#updateUnlessOver(matchID, result === undefined ? { status } : { status, result });
    }

    #updateUnlessOver(matchID, values) {
        const record = this.records[matchID];
        if (record === undefined || TERMINAL.includes(record.status)) {
            return false;
        }
        Object.assign(record, structuredClone(values));
        return true;
    }
}

const TERMINAL = ['ENDED', 'ABANDONED', 'CANCELLED', 'ABORTED'];

/** An exit() stub for the lifecycle: `exited` resolves with the exit code. */
export function exitStub() {
    let resolve;
    const exited = new Promise(r => {
        resolve = r;
    });
    const exit = code => {
        exit.calls.push(code);
        resolve(code);
    };
    exit.calls = [];
    exit.exited = exited;
    return exit;
}

/** Start a client on the per-match path, websocket only. */
export function startClient({ port, game = Tally, matchID, playerID, credentials, pathMatchID = matchID }) {
    const client = Client({
        game,
        matchID,
        playerID,
        credentials,
        multiplayer: SocketIO({
            server: `http://localhost:${port}`,
            socketOpts: { path: `/m/${pathMatchID}/socket.io`, transports: ['websocket'], reconnection: false },
        }),
    });
    client.start();
    return client;
}

/** True once the server has answered the client's sync (so it was let in). */
export const isSynced = client => client.matchData !== undefined;

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Resolve true when check() is true, or false after timeoutMs. */
export async function waitFor(check, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) {
            return true;
        }
        await sleep(25);
    }
    return check();
}

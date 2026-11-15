// Spike S3: boardgame.io server internals, run locally (no AWS).
//
// For both routing-key modes ("path", the plan, and "query", the fallback),
// start a one-match server in-process and check that:
//   - a match can be seeded under a chosen match ID with chosen credentials,
//   - the right credentials can play and wrong ones can't,
//   - a connection meant for another match is refused,
//   - the storage wrapper sees activity and game over,
//   - the health check answers and boardgame.io's Lobby API is hidden.
//
// Usage: node s3/run-s3.js
import { isSynced, sleep, socketOf, startClient, waitFor } from '../client/bgio-client.js';
import { startServer } from '../server/server.js';
import { Tally } from './test-game.js';

const MATCH_ID = 'spike-s3-7f3a';
const CREDENTIALS = { '0': 'secret0', '1': 'secret1' };

let failures = 0;
function check(ok, description) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${description}`);
    if (!ok) {
        failures += 1;
    }
}

async function serverCount(storage) {
    const { state } = await storage.fetch(MATCH_ID, { state: true });
    return state.G.count;
}

async function runMode(socketPathMode) {
    console.log(`\nMode: ${socketPathMode}`);
    let gameoverSeen;
    const { port, storage, stop } = await startServer({
        game: Tally,
        matchID: MATCH_ID,
        credentials: CREDENTIALS,
        port: 0,
        socketPathMode,
        onGameOver: (_, gameover) => { gameoverSeen = gameover; },
    });
    const server = `http://localhost:${port}`;
    const clients = [];
    const connect = opts => {
        const client = startClient({ server, game: Tally, matchID: MATCH_ID, socketPathMode, ...opts });
        clients.push(client);
        return client;
    };

    try {
        // Seeding and the right credentials.
        const player0 = connect({ playerID: '0', credentials: CREDENTIALS['0'] });
        check(await waitFor(() => isSynced(player0)), 'client with the right credentials syncs with the seeded match');
        player0.moves.bump();
        await sleep(300);
        check((await serverCount(storage)) === 1, 'its move is applied on the server');

        // Wrong credentials.
        const impostor = connect({ playerID: '0', credentials: 'wrong' });
        await sleep(1000);
        check(!isSynced(impostor), 'client with wrong credentials is refused at sync');
        // The refused client has no state to make moves from, so forge the
        // update message a modified client could send.
        const { state } = await storage.fetch(MATCH_ID, { state: true });
        const forged = { type: 'MAKE_MOVE', payload: { type: 'bump', args: [], playerID: '0', credentials: 'wrong' } };
        socketOf(impostor).emit('update', forged, state._stateID, MATCH_ID, '0');
        await sleep(300);
        check((await serverCount(storage)) === 1, 'a move sent with wrong credentials is not applied');

        // A connection meant for another match.
        const stray = connect({ playerID: '0', credentials: CREDENTIALS['0'], pathMatchID: 'some-other-match' });
        let strayError = false;
        socketOf(stray).on('connect_error', () => { strayError = true; });
        await waitFor(() => strayError, 2000);
        check(strayError && !socketOf(stray).connected, 'a connection for another match ID is refused');

        // Activity tracking and game over.
        const writesBefore = storage.writeCount;
        const activityBefore = storage.lastActivity;
        await sleep(20);
        player0.moves.bump();
        player0.moves.bump();
        await waitFor(() => gameoverSeen !== undefined);
        check(storage.writeCount >= writesBefore + 2, `wrapper counted the writes (${storage.writeCount} total)`);
        check(storage.lastActivity > activityBefore, 'wrapper updated lastActivity');
        check(gameoverSeen?.winner === '0', `wrapper saw game over: ${JSON.stringify(gameoverSeen)}`);

        // HTTP routes.
        const health = await fetch(`${server}/m/${MATCH_ID}/healthz`);
        check(health.status === 200, 'health check answers 200');
        const lobby = await fetch(`${server}/games/tally`);
        check(lobby.status === 404, "boardgame.io's Lobby API is hidden (404)");
    } finally {
        for (const client of clients) {
            client.stop();
        }
        stop();
    }
}

await runMode('path');
await runMode('query');
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

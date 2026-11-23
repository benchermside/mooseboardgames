// T6 end to end, in-process: a fake match table, a real boardgame.io server,
// and real Socket.IO clients.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { hostMatch } from '../src/host.js';
import { MatchRecordError } from '../src/match-record.js';
import { CREDENTIALS, exitStub, FakeMatchTable, isSynced, sampleRecord, sleep, startClient, TEST_GAMES, waitFor } from './helpers.js';

const MATCH_ID = 'm_test';
const cleanups = [];
afterEach(() => {
    while (cleanups.length > 0) {
        cleanups.pop()();
    }
});

async function host(record = sampleRecord(), table = new FakeMatchTable({ [MATCH_ID]: record })) {
    const hosted = await hostMatch({ matchID: MATCH_ID, table, games: TEST_GAMES, port: 0, exit: exitStub(), startedAt: Date.now() });
    if (hosted.outcome === 'listening') {
        // Stops the server and the lifecycle's timers.
        cleanups.push(() => hosted.lifecycle.onStopSignal());
    }
    return { hosted, table };
}

function connect(port, opts) {
    const client = startClient({ port, matchID: MATCH_ID, ...opts });
    cleanups.push(() => client.stop());
    return client;
}

async function serverCount(storage) {
    const { state } = await storage.fetch(MATCH_ID, { state: true });
    return state.G.count;
}

test('hosts the match in the record and marks it listening', async () => {
    const { hosted, table } = await host();
    assert.equal(hosted.outcome, 'listening');
    assert.equal(table.records[MATCH_ID].listening, true);

    const player0 = connect(hosted.port, { playerID: '0', credentials: CREDENTIALS[0] });
    assert.ok(await waitFor(() => isSynced(player0)), 'player 0 syncs');
    player0.moves.bump();
    assert.ok(await waitFor(async () => (await serverCount(hosted.storage)) === 1), 'the move is applied');
});

test('each seat needs its own credential from the record', async () => {
    const { hosted } = await host();
    const impostor = connect(hosted.port, { playerID: '1', credentials: CREDENTIALS[0] });
    await sleep(500);
    assert.equal(isSynced(impostor), false, 'player 0\'s credential doesn\'t work for seat 1');
});

test('a connection for another match is refused', async () => {
    const { hosted } = await host();
    const stray = connect(hosted.port, { playerID: '0', credentials: CREDENTIALS[0], pathMatchID: 'm_other' });
    await sleep(500);
    assert.equal(isSynced(stray), false);
});

test('setup_data and num_players from the record reach the game', async () => {
    const credentials = { 0: 'a', 1: 'b', 2: 'c' };
    const { hosted } = await host(sampleRecord({ num_players: 3, credentials, setup_data: { start: 2 } }));
    assert.equal(await serverCount(hosted.storage), 2);
    const { metadata } = await hosted.storage.fetch(MATCH_ID, { metadata: true });
    assert.equal(Object.keys(metadata.players).length, 3);
});

test('health check answers on the match path; everything else is 404', async () => {
    const { hosted } = await host();
    const base = `http://localhost:${hosted.port}`;
    assert.equal((await fetch(`${base}/m/${MATCH_ID}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/m/m_other/healthz`)).status, 404);
    assert.equal((await fetch(`${base}/games/tally`)).status, 404, 'boardgame.io\'s Lobby API is hidden');
});

test('a match that already ended is not hosted', async () => {
    const { hosted, table } = await host(sampleRecord({ status: 'CANCELLED' }));
    assert.deepEqual(hosted, { outcome: 'already-over', status: 'CANCELLED' });
    assert.equal(table.records[MATCH_ID].listening, undefined);
});

test('a match cancelled while the server starts is not hosted', async () => {
    const table = new FakeMatchTable({ [MATCH_ID]: sampleRecord() });
    table.beforeMarkListening = () => {
        table.records[MATCH_ID].status = 'CANCELLED';
    };
    const { hosted } = await host(undefined, table);
    assert.deepEqual(hosted, { outcome: 'already-over', status: 'CANCELLED' });
});

test('a missing or bad record is an error', async () => {
    await assert.rejects(host(undefined, new FakeMatchTable({})), MatchRecordError);
    await assert.rejects(host(sampleRecord({ game_name: 'nope' })), MatchRecordError);
});

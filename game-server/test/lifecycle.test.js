// T7 and T8 end to end, in-process, with short timeouts: a fake match table,
// a real boardgame.io server, and real Socket.IO clients.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { hostMatch } from '../src/host.js';
import { CREDENTIALS, exitStub, FakeMatchTable, isSynced, sampleRecord, sleep, startClient, TALLY_IDLE_TIMEOUT_MS, TALLY_MAX_LIFETIME_MS, TEST_GAMES, waitFor } from './helpers.js';

const MATCH_ID = 'm_test';
const SHORT = { waitingRoomMs: 400, idleMs: 400, gameOverGraceMs: 300 };

const cleanups = [];
afterEach(() => {
    while (cleanups.length > 0) {
        cleanups.pop()();
    }
});

async function host({ record = sampleRecord(), timeouts = SHORT, startedAt = Date.now() } = {}) {
    const table = new FakeMatchTable({ [MATCH_ID]: record });
    const exit = exitStub();
    const hosted = await hostMatch({ matchID: MATCH_ID, table, games: TEST_GAMES, port: 0, timeouts, exit, startedAt });
    cleanups.push(() => hosted.lifecycle.onStopSignal());
    const status = () => table.records[MATCH_ID].status;
    return { hosted, table, exit, status };
}

function connect(port, seat) {
    const client = startClient({ port, matchID: MATCH_ID, playerID: seat, credentials: CREDENTIALS[seat] });
    // A client that was already stopped throws if stopped again.
    cleanups.push(() => client.transport.socket && client.stop());
    return client;
}

/** Connect every seat and wait until the server has counted them all. */
async function fillSeats(port, status) {
    const clients = ['0', '1'].map(seat => connect(port, seat));
    assert.ok(await waitFor(() => clients.every(isSynced)), 'both seats sync');
    assert.ok(await waitFor(() => status() === 'IN_PROGRESS'), 'status becomes IN_PROGRESS');
    return clients;
}

/** Whether the server still answers its health check. */
async function answering(port) {
    try {
        return (await fetch(`http://localhost:${port}/m/${MATCH_ID}/healthz`)).ok;
    } catch {
        return false;
    }
}

test('the waiting room times out: CANCELLED, then exit', async () => {
    const { hosted, exit, status } = await host();
    connect(hosted.port, '0');  // only one of the two seats
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'CANCELLED');
    assert.equal(await answering(hosted.port), false, 'the server has stopped');
});

test('once every seat connects the match is IN_PROGRESS and the waiting room can\'t time out', async () => {
    const timeouts = { ...SHORT, idleMs: 60_000 };
    const { hosted, exit, status } = await host({ timeouts });
    await fillSeats(hosted.port, status);
    await sleep(SHORT.waitingRoomMs + 200);
    assert.equal(status(), 'IN_PROGRESS');
    assert.deepEqual(exit.calls, []);
});

test('a player disconnecting during the waiting room doesn\'t count as joined', async () => {
    const { hosted, exit, status } = await host({ timeouts: { ...SHORT, waitingRoomMs: 800 } });
    const first = connect(hosted.port, '0');
    assert.ok(await waitFor(() => isSynced(first)));
    first.stop();
    await sleep(100);
    const second = connect(hosted.port, '1');
    assert.ok(await waitFor(() => isSynced(second)));
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'CANCELLED');
});

test('moves keep the match alive; no moves for the game\'s idle timeout ends it ABANDONED', async () => {
    // No idleMs override, so Tally's own idle timeout (games list) applies.
    const { idleMs: _, ...timeouts } = SHORT;
    const { hosted, exit, status } = await host({ timeouts });
    assert.equal(hosted.lifecycle.timeouts.idleMs, TALLY_IDLE_TIMEOUT_MS);
    const [player0] = await fillSeats(hosted.port, status);
    // Tally ends after 3 moves, so make 2, each within the idle timeout.
    for (let i = 0; i < 2; i += 1) {
        await sleep(TALLY_IDLE_TIMEOUT_MS * 0.6);
        player0.moves.bump();
    }
    await sleep(TALLY_IDLE_TIMEOUT_MS * 0.6);
    assert.deepEqual(exit.calls, [], 'still running after more than one idle timeout in total');
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'ABANDONED');
});

test('game over: ENDED with the result, and exit only after the grace period', async () => {
    const { hosted, table, exit, status } = await host({ timeouts: { ...SHORT, gameOverGraceMs: 600 } });
    const [player0] = await fillSeats(hosted.port, status);
    for (let i = 0; i < 3; i += 1) {
        player0.moves.bump();
    }
    assert.ok(await waitFor(() => status() === 'ENDED'), 'status becomes ENDED');
    assert.deepEqual(table.records[MATCH_ID].result, { winner: '0' });
    assert.ok(await waitFor(() => player0.getState()?.ctx.gameover !== undefined), 'the client sees game over');
    assert.equal(await answering(hosted.port), true, 'still up during the grace period');
    assert.equal(await exit.exited, 0);
    assert.equal(await answering(hosted.port), false);
});

test('the default waiting room is 15 minutes, and an idleMs override beats the game\'s', async () => {
    const { hosted } = await host({ timeouts: { idleMs: 1234 } });
    assert.equal(hosted.lifecycle.timeouts.waitingRoomMs, 15 * 60_000);
    assert.equal(hosted.lifecycle.timeouts.idleMs, 1234);
});

test('expires_at is the game\'s maximum lifetime after the process started', async () => {
    const startedAt = Date.now() - 5000;
    const { idleMs: _, ...timeouts } = SHORT;
    const { table } = await host({ timeouts: { ...timeouts, waitingRoomMs: 60_000 }, startedAt });
    assert.equal(table.records[MATCH_ID].expires_at, new Date(startedAt + TALLY_MAX_LIFETIME_MS).toISOString());
});

test('reaching the maximum lifetime ends an active match ABANDONED', async () => {
    const timeouts = { ...SHORT, idleMs: 300, maxLifetimeMs: 900 };
    // Tally ends when the count reaches 3; start it far below, so it doesn't.
    const record = sampleRecord({ setup_data: { start: -1000 } });
    const { hosted, exit, status } = await host({ record, timeouts });
    const [player0] = await fillSeats(hosted.port, status);
    // Moves keep the idle timer from firing; the lifetime still runs out.
    const mover = setInterval(() => player0.moves.bump(), 150);
    cleanups.push(() => clearInterval(mover));
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'ABANDONED');
});

test('reaching the maximum lifetime in the waiting room ends it ABANDONED', async () => {
    const { exit, status } = await host({ timeouts: { ...SHORT, waitingRoomMs: 60_000, maxLifetimeMs: 300 } });
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'ABANDONED');
});

test('a stop signal while waiting: CANCELLED, exit at once', async () => {
    const { hosted, exit, status } = await host({ timeouts: { ...SHORT, waitingRoomMs: 60_000 } });
    hosted.lifecycle.onStopSignal();
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'CANCELLED');
});

test('a stop signal mid-game: ABORTED, exit at once', async () => {
    const { hosted, exit, status } = await host({ timeouts: { ...SHORT, idleMs: 60_000 } });
    await fillSeats(hosted.port, status);
    hosted.lifecycle.onStopSignal();
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'ABORTED');
});

test('a stop signal during the grace period exits at once and keeps ENDED', async () => {
    const { hosted, exit, status } = await host({ timeouts: { ...SHORT, gameOverGraceMs: 60_000 } });
    const [player0] = await fillSeats(hosted.port, status);
    for (let i = 0; i < 3; i += 1) {
        player0.moves.bump();
    }
    assert.ok(await waitFor(() => status() === 'ENDED'));
    hosted.lifecycle.onStopSignal();
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'ENDED');
});

test('an ending recorded elsewhere first is kept', async () => {
    const { hosted, table, exit, status } = await host({ timeouts: { ...SHORT, waitingRoomMs: 60_000 } });
    table.records[MATCH_ID].status = 'CANCELLED';  // the lobby cancels
    hosted.lifecycle.onStopSignal();               // then calls StopTask
    assert.equal(await exit.exited, 0);
    assert.equal(status(), 'CANCELLED');
});

test('if the ending can\'t be recorded, exit 1', async () => {
    const { hosted, table, exit } = await host({ timeouts: { ...SHORT, waitingRoomMs: 60_000 } });
    table.setStatus = async () => {
        throw new Error('DynamoDB is down');
    };
    hosted.lifecycle.onStopSignal();
    assert.equal(await exit.exited, 1);
});

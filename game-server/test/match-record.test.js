import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_GAMES, GAMES } from '../src/games.js';
import { MatchRecordError, parseMatchRecord } from '../src/match-record.js';
import { sampleRecord, Tally, TALLY_IDLE_TIMEOUT_MS, TALLY_MAX_LIFETIME_MS, TEST_GAMES } from './helpers.js';

const parse = item => parseMatchRecord('m_test', item, TEST_GAMES);
const rejects = (item, pattern) => assert.throws(() => parse(item), err => err instanceof MatchRecordError && pattern.test(err.message));

test('a valid record parses', () => {
    const match = parse(sampleRecord({ setup_data: { start: 1 } }));
    assert.equal(match.game, Tally);
    assert.equal(match.gameName, 'tally');
    assert.equal(match.idleTimeoutMs, TALLY_IDLE_TIMEOUT_MS);
    assert.equal(match.maxLifetimeMs, TALLY_MAX_LIFETIME_MS);
    assert.equal(match.numPlayers, 2);
    assert.deepEqual(match.setupData, { start: 1 });
    assert.deepEqual(match.credentials, { 0: 'secret0', 1: 'secret1' });
    assert.equal(match.status, 'CREATED');
});

test('a missing record is an error', () => rejects(undefined, /No match record/));

test('an unknown game is an error', () => {
    rejects(sampleRecord({ game_name: 'chess' }), /unknown game_name "chess"/);
    rejects(sampleRecord({ game_name: 'constructor' }), /unknown game_name/);
});

test('a missing status is an error', () => rejects(sampleRecord({ status: undefined }), /status is missing/));

test('num_players must be a whole number in the game\'s range', () => {
    rejects(sampleRecord({ num_players: '2' }), /num_players/);
    rejects(sampleRecord({ num_players: 0 }), /num_players/);
    rejects(sampleRecord({ num_players: 5 }), /can't be played by 5 players/);
});

test('there must be exactly one credential per seat', () => {
    rejects(sampleRecord({ credentials: { 0: 'a' } }), /seats 0, 1; it has 0$/);
    rejects(sampleRecord({ credentials: { 0: 'a', 1: 'b', 2: 'c' } }), /it has 0, 1, 2/);
    rejects(sampleRecord({ credentials: { 1: 'a', 2: 'b' } }), /it has 1, 2/);
    rejects(sampleRecord({ credentials: {} }), /it has none/);
    rejects(sampleRecord({ credentials: ['a', 'b'] }), /must be a map/);
    rejects(sampleRecord({ credentials: { 0: 'a', 1: '' } }), /seat 1 must be a non-empty string/);
});

test('setup_data must be a map if present', () => rejects(sampleRecord({ setup_data: 'x' }), /setup_data/));

test('every registered game is keyed by its own name', () => {
    assert.ok(Object.keys(GAMES).length > 0);
    for (const [name, { game }] of Object.entries(GAMES)) {
        assert.equal(game.name, name);
    }
    assert.ok(GAMES.ur);
});

test('every game sets its own idle timeout and maximum lifetime', () => {
    for (const entry of ALL_GAMES) {
        const name = entry.game.name;
        assert.ok(entry.idleTimeoutMs > 0, `${name} sets idleTimeoutMs in games.js`);
        assert.ok(entry.maxLifetimeMs > 0, `${name} sets maxLifetimeMs in games.js`);
        assert.ok(entry.maxLifetimeMs > entry.idleTimeoutMs, `${name}'s maxLifetimeMs is longer than its idleTimeoutMs`);
    }
});

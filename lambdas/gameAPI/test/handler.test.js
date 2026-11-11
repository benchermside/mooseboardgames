import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { Ure } from '../../../games/ur/src/game.js';
import { createHandler } from '../src/handler.js';
import { createFakeDb, createFakePost } from './fakes.js';

const MATCH_ID = 'm_test';

let db;
let post;
let handler;

beforeEach(() => {
    db = createFakeDb();
    post = createFakePost();
    // A fixed seed makes the dice rolls the same on every run.
    handler = createHandler({ db, makePost: post.makePost, games: { ur: { ...Ure, seed: 'test' } } });
    // What the lobby's "start game" route writes.
    db.matches.set(MATCH_ID, {
        match_id: MATCH_ID,
        game_name: 'ur',
        seats: { token0: '0', token1: '1' },
    });
});

const requestContext = (routeKey, connectionId) =>
    ({ routeKey, connectionId, domainName: 'ws.example.com', stage: 'dev' });

const connect = (connectionId, query) =>
    handler({ requestContext: requestContext('$connect', connectionId), queryStringParameters: query });

const send = (connectionId, body) =>
    handler({ requestContext: requestContext('$default', connectionId), body: JSON.stringify(body) });

/** A boardgame.io MAKE_MOVE action, as the client builds it. */
const move = (type, args, playerID) => ({ type: 'MAKE_MOVE', payload: { type, args, playerID } });

const update = (connectionId, action, stateID) => send(connectionId, { type: 'update', args: [action, stateID] });

const savedState = () => JSON.parse(db.matches.get(MATCH_ID).state);

const messagesTo = (connectionId) => post.sent[connectionId] ?? [];

/** Connect both players and have both sync, then forget the sync messages. */
async function startGame() {
    await connect('c0', { match: MATCH_ID, token: 'token0' });
    await connect('c1', { match: MATCH_ID, token: 'token1' });
    await send('c0', { type: 'sync' });
    await send('c1', { type: 'sync' });
    post.sent.c0 = [];
    post.sent.c1 = [];
}

describe('$connect', () => {
    it('accepts a seat token and records which player the connection is', async () => {
        const response = await connect('c1', { match: MATCH_ID, token: 'token1' });
        assert.equal(response.statusCode, 200);
        const connection = db.connections.get('c1');
        assert.equal(connection.match_id, MATCH_ID);
        assert.equal(connection.player_id, '1');
        assert.equal(connection.num_players, 2);
    });

    it('rejects a wrong token, an unknown match, or missing parameters', async () => {
        assert.equal((await connect('c', { match: MATCH_ID, token: 'nope' })).statusCode, 403);
        assert.equal((await connect('c', { match: 'm_missing', token: 'token0' })).statusCode, 403);
        assert.equal((await connect('c', { match: MATCH_ID })).statusCode, 400);
        assert.equal((await connect('c', undefined)).statusCode, 400);
        assert.equal(db.connections.size, 0);
    });
});

describe('$disconnect', () => {
    it('forgets the connection', async () => {
        await connect('c0', { match: MATCH_ID, token: 'token0' });
        await handler({ requestContext: requestContext('$disconnect', 'c0') });
        assert.equal(db.connections.size, 0);
    });
});

describe('sync', () => {
    it('creates the game on the first sync and sends it only to that player', async () => {
        await connect('c0', { match: MATCH_ID, token: 'token0' });
        await connect('c1', { match: MATCH_ID, token: 'token1' });
        assert.equal((await send('c0', { type: 'sync' })).statusCode, 200);

        assert.equal(db.matches.get(MATCH_ID).state_id, 0);
        assert.equal(messagesTo('c0').length, 1);
        assert.equal(messagesTo('c1').length, 0);
        const [message] = messagesTo('c0');
        assert.equal(message.type, 'sync');
        assert.equal(message.args[0], MATCH_ID);
        assert.equal(message.args[1].state.G[0].remainingPieces, 7);
    });

    it('gives the second player the same game instead of making a new one', async () => {
        await connect('c0', { match: MATCH_ID, token: 'token0' });
        await connect('c1', { match: MATCH_ID, token: 'token1' });
        await send('c0', { type: 'sync' });
        await send('c1', { type: 'sync' });
        assert.deepEqual(messagesTo('c1')[0].args[1].state, messagesTo('c0')[0].args[1].state);
    });

    it('uses the game the other player created at the same moment', async () => {
        await connect('c0', { match: MATCH_ID, token: 'token0' });
        await connect('c1', { match: MATCH_ID, token: 'token1' });
        // Player 0's sync reads the match first, then player 1's whole sync
        // runs (creating the game) before player 0's sync tries to create it.
        const realGetMatch = db.getMatch;
        let otherPlayerSynced = false;
        db.getMatch = async (matchID) => {
            const match = await realGetMatch.call(db, matchID);
            if (!otherPlayerSynced) {
                otherPlayerSynced = true;
                await send('c1', { type: 'sync' });
            }
            return match;
        };
        assert.equal((await send('c0', { type: 'sync' })).statusCode, 200);
        assert.equal(messagesTo('c0').length, 1);
        assert.deepEqual(messagesTo('c0')[0].args[1].state, messagesTo('c1')[0].args[1].state);
    });
});

describe('update', () => {
    it('applies a move, saves it, and sends it to both players', async () => {
        await startGame();
        await update('c0', move('roll', ['0'], '0'), 0);

        const state = savedState();
        assert.equal(state._stateID, 1);
        assert.equal(db.matches.get(MATCH_ID).state_id, 1);
        assert.notEqual(state.G[0].roll, null);
        for (const connectionId of ['c0', 'c1']) {
            const [message] = messagesTo(connectionId);
            assert.equal(message.type, 'update');
            assert.equal(message.args[0], MATCH_ID);
            assert.equal(message.args[1]._stateID, 1);
        }
    });

    it('ignores a move from the player whose turn it is not, even if it claims to be the other player', async () => {
        await startGame();
        await update('c1', move('roll', ['1'], '1'), 0);
        await update('c1', move('roll', ['0'], '0'), 0);
        assert.equal(savedState()._stateID, 0);
        assert.deepEqual(messagesTo('c0'), []);
        assert.deepEqual(messagesTo('c1'), []);
    });

    it('ignores a move based on an old state', async () => {
        await startGame();
        await update('c0', move('roll', ['0'], '0'), 0);
        const after = savedState();
        post.sent.c0 = [];
        post.sent.c1 = [];

        await update('c0', move('roll', ['0'], '0'), 0);
        assert.deepEqual(savedState(), after);
        assert.deepEqual(messagesTo('c0'), []);
        assert.deepEqual(messagesTo('c1'), []);
    });

    it('drops a move when another was saved first, and re-syncs that player', async () => {
        await startGame();
        db.beforeSetMatchState = async (matchID) => {
            db.beforeSetMatchState = undefined;
            db.matches.get(matchID).state_id = 99;
        };
        assert.equal((await update('c0', move('roll', ['0'], '0'), 0)).statusCode, 200);

        assert.equal(savedState()._stateID, 0);
        assert.deepEqual(messagesTo('c1'), []);
        assert.equal(messagesTo('c0').length, 1);
        assert.equal(messagesTo('c0')[0].type, 'sync');
    });

    it('only writes the state for a move that changed it, and never rewrites metadata mid-game', async () => {
        await startGame();
        const writes = [];
        const realSetMatchState = db.setMatchState;
        db.setMatchState = (...args) => { writes.push('state'); return realSetMatchState.apply(db, args); };
        db.setMatchMetadata = async () => { writes.push('metadata'); };

        // Rejected: it's time to roll, not to move a piece.
        await update('c0', move('clickCell', [0, 'b'], '0'), 0);
        assert.deepEqual(writes, []);

        await update('c0', move('roll', ['0'], '0'), 0);
        assert.deepEqual(writes, ['state']);
    });

    it('forgets a connection that has gone away', async () => {
        await startGame();
        post.gone.add('c1');
        assert.equal((await update('c0', move('roll', ['0'], '0'), 0)).statusCode, 200);
        assert.equal(messagesTo('c0').length, 1);
        assert.equal(db.connections.has('c1'), false);
    });
});

describe('messages', () => {
    it('rejects messages from unknown connections, bad JSON, and unknown types', async () => {
        assert.equal((await send('nobody', { type: 'sync' })).statusCode, 403);
        await connect('c0', { match: MATCH_ID, token: 'token0' });
        const badJSON = await handler({ requestContext: requestContext('$default', 'c0'), body: '{' });
        assert.equal(badJSON.statusCode, 400);
        assert.equal((await send('c0', { type: 'shout' })).statusCode, 400);
        assert.equal((await send('c0', { type: 'update', args: [] })).statusCode, 400);
    });
});

describe('a whole game', () => {
    it('can be played to the end through the handler', async () => {
        await startGame();
        const connectionFor = { 0: 'c0', 1: 'c1' };
        let state = savedState();
        let actions = 0;
        while (state.ctx.gameover === undefined) {
            assert.ok(actions < 5000, 'the game should end');
            const player = state.ctx.currentPlayer;
            const connectionId = connectionFor[player];
            if (state.G.step === 'rolling') {
                await update(connectionId, move('roll', [player], player), state._stateID);
            } else {
                // Click squares in order until one is a legal move.
                const before = state._stateID;
                for (let destination = 0; destination <= 14 && savedState()._stateID === before; destination++) {
                    const row = (destination >= 4 && destination <= 11) ? 'm' : (player === '0' ? 'b' : 't');
                    await update(connectionId, move('clickCell', [destination, row], player), before);
                }
                assert.notEqual(savedState()._stateID, before,
                    `player ${player} rolled ${state.G[player].roll} but has no legal move`);
            }
            actions++;
            state = savedState();
        }
        assert.equal(state.G[state.ctx.gameover.winner].finishedPieces, 7);
        assert.ok(JSON.parse(db.matches.get(MATCH_ID).metadata).gameover);
    });
});

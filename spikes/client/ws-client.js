// Spike S1 client: connect to a Fargate-hosted match through CloudFront and
// Lambda@Edge, play, sit idle, then prove the connection still works.
//
// Usage:
//   node client/ws-client.js --url https://dXXXX.cloudfront.net --match <matchID>
//       [--player 0] [--cred cred0] [--idle-minutes 20]
//
// It uses the same boardgame.io client and Socket.IO options the browser
// will (websocket only, per-match path), with reconnection turned off so any
// dropped connection shows up instead of being quietly repaired.
import { parseArgs } from 'node:util';
import { Ure } from '../../games/ur/src/game.js';
import { isSynced, sleep, socketOf, startClient, waitFor } from './bgio-client.js';

const { values: args } = parseArgs({
    options: {
        url: { type: 'string' },
        match: { type: 'string' },
        player: { type: 'string', default: '0' },
        cred: { type: 'string', default: 'cred0' },
        'idle-minutes': { type: 'string', default: '20' },
    },
});
if (!args.url || !args.match) {
    console.error('Usage: node client/ws-client.js --url https://dXXXX.cloudfront.net --match <matchID> [--idle-minutes 20]');
    process.exit(2);
}
const idleMinutes = Number(args['idle-minutes']);

const t0 = performance.now();
function log(message) {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(`${new Date().toISOString()} [+${elapsed}s] ${message}`);
}

/** Send a chat message and resolve true when the server echoes it back. */
async function chatRoundTrip(client, text) {
    const before = client.chatMessages.length;
    const start = performance.now();
    client.sendChatMessage(text);
    const ok = await waitFor(() => client.chatMessages.length > before, 10000);
    log(ok ? `chat round trip OK in ${(performance.now() - start).toFixed(0)} ms` : 'chat round trip FAILED');
    return ok;
}

let ok = true;
log(`connecting to ${args.url} as player ${args.player} in match ${args.match}`);
const client = startClient({
    server: args.url,
    game: Ure,
    matchID: args.match,
    playerID: args.player,
    credentials: args.cred,
});
const socket = socketOf(client);
let pings = 0;
let disconnects = 0;
socket.on('connect', () => log(`socket connected (transport: ${socket.io.engine.transport.name})`));
socket.on('connect_error', err => log(`connect_error: ${err.message}`));
socket.on('disconnect', reason => {
    disconnects += 1;
    log(`DISCONNECTED: ${reason}`);
});
socket.io.on('ping', () => { pings += 1; });

if (!await waitFor(() => isSynced(client), 20000)) {
    log('FAIL: never synced with the server');
    process.exit(1);
}
log('synced with the match');

// A real move. Ur's roll uses randomness, which only the server runs, so a
// non-null roll means the server applied it and sent the result back.
if (client.getState().ctx.currentPlayer === args.player && client.getState().G.step === 'rolling') {
    client.moves.roll(args.player);
    const rolled = await waitFor(() => client.getState().G[args.player].roll !== null, 10000);
    log(rolled ? `move OK: rolled ${client.getState().G[args.player].roll}` : 'move FAILED');
    ok &&= rolled;
} else {
    log('not this player\'s turn to roll; skipping the move check');
}
ok &&= await chatRoundTrip(client, 'before idle');

log(`idling for ${idleMinutes} minutes...`);
const idleEnd = Date.now() + idleMinutes * 60_000;
while (Date.now() < idleEnd && socket.connected) {
    await sleep(Math.min(60_000, idleEnd - Date.now()));
    log(`still idle: connected=${socket.connected} pings=${pings} disconnects=${disconnects}`);
}

ok &&= socket.connected && disconnects === 0;
ok &&= await chatRoundTrip(client, 'after idle');
log(ok ? 'S1 RESULT: PASS' : 'S1 RESULT: FAIL');
client.stop();
process.exit(ok ? 0 : 1);

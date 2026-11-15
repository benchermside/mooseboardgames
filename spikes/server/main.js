// Container entrypoint for the spike game server.
//
// Environment:
//   MATCH_ID          required
//   PORT              default 8000
//   SEAT_CREDENTIALS  JSON, e.g. {"0":"cred0","1":"cred1"}. Stands in for the
//                     DynamoDB match record the real server will read.
//   SOCKET_PATH_MODE  "path" (default) or "query"; see server.js
import { Ure } from '../../games/ur/src/game.js';
import { log, startServer } from './server.js';

log('STARTING');

const matchID = process.env.MATCH_ID;
if (!matchID) {
    console.error('MATCH_ID is not set');
    process.exit(1);
}
const credentials = JSON.parse(process.env.SEAT_CREDENTIALS ?? '{"0":"cred0","1":"cred1"}');

const { port } = await startServer({
    game: Ure,
    matchID,
    credentials,
    port: Number(process.env.PORT ?? 8000),
    socketPathMode: process.env.SOCKET_PATH_MODE ?? 'path',
    onActivity: () => log('ACTIVITY'),
    onGameOver: (_, gameover) => log(`GAMEOVER ${JSON.stringify(gameover)}`),
});
log(`LISTENING port=${port} matchID=${matchID}`);

// StopTask sends SIGTERM. The real server will record a terminal status here.
process.on('SIGTERM', () => {
    log('SIGTERM received, exiting');
    process.exit(0);
});

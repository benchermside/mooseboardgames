// Stand-alone boardgame.io server for working on the game logic by itself
// (`npm run serve`). The real site uses the gameAPI Lambda instead.
// Port 8001, because DynamoDB Local in `just dev` uses 8000.
import { Server, Origins } from 'boardgame.io/dist/cjs/server.js';
import { Ure } from './game.js';

const server = Server({
    games: [Ure],
    origins: [Origins.LOCALHOST],
});

server.run(8001);

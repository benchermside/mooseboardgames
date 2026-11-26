import {Client} from 'boardgame.io/client';
import {StarveTheFox, spaceIdMap, forwardConnections, isValidTarget} from './game';
import {SocketIO} from 'boardgame.io/multiplayer'

// http://localhost:1235/?player=0   <-- the "fox".
// http://localhost:1235/?player=1   <-- the "sheep".
const params = new URLSearchParams(window.location.search);
const playerID = params.get("player");   // "0", "1", or null

/**
 * Client object for the StarveTheFox game.
 */
class StarveTheFoxClient {
    constructor(rootElem, { playerID } = {}) {
        this.client = Client({
            game: StarveTheFox,
            multiplayer: SocketIO({server: 'localhost:8001'}),
            playerID
        });
        this.client.start();
        this.rootElem = rootElem;
        this.createBoard();
        // FIXME: Need to set call attachListeners()
        this.client.subscribe(state => this.update(state));
    }

    /** Called once at the start to set up the board. */
    createBoard() {
        const lines = Array.from(forwardConnections, connection => {
            const c1 = connection[0];
            const r1 = connection[1];
            const c2 = connection[2];
            const r2 = connection[3];
            return `<line class="edge" x1="${c1}.5" y1="${r1}.5" x2="${c2}.5" y2="${r2}.5"/>`;
        });

        const spaces = Array.from(spaceIdMap.values(), value => {
            let col = value[0];
            let row = value[1];
            return `<circle class="space" data-id="${col}${row}" cx="${col}.5" cy="${row}.5" r="0.2"/>`
        });

        this.rootElem.innerHTML = `<svg class="board" viewBox="0 0 7 7">${lines.join("")}${spaces.join("")}</svg>`
    }

    /** Called after every state change to update the rendering of the board. */
    update(state) {
        if (state === null) {
            return;
        }
        const spaces = this.rootElem.querySelectorAll(".space");
        spaces.forEach(space => {
            const col = Number((space.dataset.id)[0]);
            const row = Number((space.dataset.id)[1]);
            const spaceId = row * 7 + col;
            const contentCode = state.G.board[spaceId];
            space.classList.toggle("sheep", contentCode === "S");
            space.classList.toggle("fox", contentCode === "F");
            space.classList.toggle("moveStart", state.G.currentMoveStart === spaceId);
            space.classList.toggle("target", isValidTarget(state.G, spaceId));
        });
    }
}


const appElement = document.getElementById('app');
const app = new StarveTheFoxClient(appElement, { playerID: playerID });

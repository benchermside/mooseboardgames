import {Client} from 'boardgame.io/client';
import {StarveTheFox} from './game';
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
        const tableTextBits = [];
        tableTextBits.push(`<table class="board">`);
        for (let row = 0; row < 7; row++) {
            tableTextBits.push("<tr>");
            for (let col = 0; col < 7; col++) {
                const dataId = 10 * (row + 1) + (col + 1);
                const classStr = ((row > 1 && row < 5) || (col > 1 && col < 5)) ? "cell" : "empty";
                tableTextBits.push(`<td class="${classStr}" data-id="${dataId}"></td>`)
            }
            tableTextBits.push("</tr>");
        }
        tableTextBits.push("</table>");
        this.rootElem.innerHTML = tableTextBits.join("");
    }

    /** Called after every state change to update the rendering of the board. */
    update(state) {
        if (state === null) {
            return;
        }
        const cells = this.rootElem.querySelectorAll(".cell");
        cells.forEach(cell => {
            const cellId = Number(cell.dataset.id);
            const row = Math.floor(cellId / 10) - 1;
            const col = (cellId % 10) - 1;
            const boardId = row * 7 + col;
            const contentCode = state.G.board[boardId];
            console.log("doing cell", cellId, "at", boardId, "with", contentCode); // FIXME: Remove
            cell.classList.toggle("sheep", contentCode === "S");
            cell.classList.toggle("fox", contentCode === "F");
        });
    }
}

const appElement = document.getElementById('app');
const app = new StarveTheFoxClient(appElement, { playerID: playerID });

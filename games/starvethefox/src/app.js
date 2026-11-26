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
        const spaces = [];
        const lines = [];
        for (let row = 0; row < 7; row++) {
            for (let col = 0; col < 7; col++) {
                if (isValidSpace([row, col])) {
                    spaces.push(
                        `<circle class="space" data-id="${row}${col}" cx="${col}.5" cy="${row}.5" r="0.2"/>`
                    );
                    // for each point, consider 4 lines we might draw from it:
                    let possibleP2 = [
                        [row, col + 1],     // line to right?
                        [row + 1, col],     // line down?
                        [row + 1, col + 1], // line down-right diagonal?
                        [row - 1, col + 1], // line up-right diagonal?
                    ];
                    possibleP2.forEach(([r2,c2]) => {
                        if (connected([row,col], [r2,c2])) {
                            lines.push(
                                `<line class="edge" x1="${col}.5" y1="${row}.5" x2="${c2}.5" y2="${r2}.5"/>`
                            );
                        }
                    })
                }
            }
        }

        this.rootElem.innerHTML = `<svg class="board" viewBox="0 0 7 7">${lines.join("")}${spaces.join("")}</svg>`
    }

    /** Called after every state change to update the rendering of the board. */
    update(state) {
        if (state === null) {
            return;
        }
        const spaces = this.rootElem.querySelectorAll(".space");
        spaces.forEach(space => {
            const row = Number((space.dataset.id)[0]);
            const col = Number((space.dataset.id)[1]);
            const contentCode = state.G.board[row * 7 + col];
            space.classList.toggle("sheep", contentCode === "S");
            space.classList.toggle("fox", contentCode === "F");
        });
    }
}


function isValidSpace([r,c]) {
    return r >= 0 && r < 7 && c >= 0 && c < 7 &&
        ((r > 1 && r < 5) || (c > 1 && c < 5));
}

function connected([r1,c1], [r2,c2]) {
    if (isValidSpace([r1,c1]) && isValidSpace([r2,c2])) {
        // Horizontal Lines:
        if ((r1 === r2) && ((c2 - c1) === 1 || ((c2 - c1) === -1))) {
            return true;
        }
        // Vertical Lines:
        if ((c1 === c2) && ((r2 - r1) === 1 || ((r2 - r1) === -1))) {
            return true;
        }
        // Diagonals:
        if (knownDiagonals.has(`${c1}${r1}${c2}${r2}`)) {
            return true;
        }
        if (knownDiagonals.has(`${c2}${r2}${c1}${r1}`)) {
            return true;
        }
    }
    return false;
}

const knownDiagonals = new Set([
    // down-right diagonals
    "2031", "3142", "4253", "5364",
    "2233", "3344",
    "0213", "1324", "2435", "3546",
    // up-right diagonals
    "0413", "1322", "2231", "3140",
    "2433", "3342",
    "6253", "5344", "4435", "3526",
]);

const appElement = document.getElementById('app');
const app = new StarveTheFoxClient(appElement, { playerID: playerID });

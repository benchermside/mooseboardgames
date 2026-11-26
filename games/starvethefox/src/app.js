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
        const lines = [];
        for (const connection of connections) {
            const r1 = connection[0];
            const c1 = connection[1];
            const r2 = connection[2];
            const c2 = connection[3];
            lines.push(
                `<line class="edge" x1="${c1}.5" y1="${r1}.5" x2="${c2}.5" y2="${r2}.5"/>`
            );
        }

        const spaces = [];
        for (let row = 0; row < 7; row++) {
            for (let col = 0; col < 7; col++) {
                if (isValidSpace([row, col])) {
                    spaces.push(
                        `<circle class="space" data-id="${row}${col}" cx="${col}.5" cy="${row}.5" r="0.2"/>`
                    );
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


/** Returns true if this is the [x,y] address of a valid space. */
function isValidSpace([r,c]) {
    return r >= 0 && r < 7 && c >= 0 && c < 7 &&
        ((r > 1 && r < 5) || (c > 1 && c < 5));
}

/** Returns true if these two [x,y] spaces both exist and are connected. */
function connected([r1,c1], [r2,c2]) {
    if (connections.has(`${c1}${r1}${c2}${r2}`)) {
        return true;
    }
    if (connections.has(`${c2}${r2}${c1}${r1}`)) {
        return true;
    }
    return false;
}

const connections = new Set([
    // horizontal
    "2030", "3040",
    "2131", "3141",
    "0212", "1222", "2232", "3242", "4252", "5262",
    "0313", "1323", "2333", "3343", "4353", "5363",
    "0414", "1424", "2434", "3444", "4454", "5464",
    "2535", "3545",
    "2636", "3646",
    // vertical
    "0203", "0304",
    "1213", "1314",
    "2021", "2122", "2223", "2324", "2425", "2526",
    "3031", "3132", "3233", "3334", "3435", "3536",
    "4041", "4142", "4243", "4344", "4445", "4546",
    "5253", "5354",
    "6263", "6364",
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

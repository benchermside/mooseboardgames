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
        const lines = Array.from(forwardConnections, connection => {
            const c1 = connection[0];
            const r1 = connection[1];
            const c2 = connection[2];
            const r2 = connection[3];
            return `<line class="edge" x1="${c1}.5" y1="${r1}.5" x2="${c2}.5" y2="${r2}.5"/>`;
        });

        const spaces = [];
        for (let row = 0; row < 7; row++) {
            for (let col = 0; col < 7; col++) {
                if (isValidSpace([col, row])) {
                    spaces.push(
                        `<circle class="space" data-id="${col}${row}" cx="${col}.5" cy="${row}.5" r="0.2"/>`
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
            const col = Number((space.dataset.id)[0]);
            const row = Number((space.dataset.id)[1]);
            const contentCode = state.G.board[row * 7 + col];
            space.classList.toggle("sheep", contentCode === "S");
            space.classList.toggle("fox", contentCode === "F");
        });
    }
}


/** Returns true if this is the [x,y] address of a valid space. */
function isValidSpace([c,r]) {
    return r >= 0 && r < 7 && c >= 0 && c < 7 &&
        ((r > 1 && r < 5) || (c > 1 && c < 5));
}

/** Returns true if these two [x,y] spaces both exist and are connected. */
function connected([c1,r1], [c2,r2]) {
    return allConnections.has(`${c1}${r1}${c2}${r2}`);
}

/**
 * The four directions a connection can run in, as [dx, dy] steps.
 *
 * We only need "forward" directions (right, down, down-right, up-right)
 * to create forwardConnections; the opposite direction in allConnections
 * will be created by swapping the ends.
 */
const DIRECTIONS = [
    { dx: 1, dy:  0, diagonal: false },  // horizontal
    { dx: 0, dy:  1, diagonal: false },  // vertical
    { dx: 1, dy:  1, diagonal: true  },  // down-right diagonal
    { dx: 1, dy: -1, diagonal: true  },  // up-right diagonal
];

/**
 * Builds the set of allowed connections between neighboring spaces.
 *
 * Each connection is a 4-character string "x1y1x2y2" (column, row, column, row).
 *
 * The rules are:
 *   - Any two spaces next to each other horizontally or vertically are connected.
 *   - Diagonal connections only run through spaces where (x + y) is even.
 *     Every space on a diagonal line has the same parity of (x + y), so this
 *     picks out every other diagonal line. That gives the usual
 *     Fox-and-Geese board pattern.
 */
function buildForwardConnections() {
    const result = new Set();
    for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
            if (!isValidSpace([x, y])) continue;
            for (const { dx, dy, diagonal } of DIRECTIONS) {
                const x2 = x + dx;
                const y2 = y + dy;
                if (!isValidSpace([x2, y2])) continue;
                if (diagonal && (x + y) % 2 !== 0) continue;
                result.add(`${x}${y}${x2}${y2}`);
            }
        }
    }
    return result;
}
const forwardConnections = buildForwardConnections();

/**
 * Builds the constant allConnections. This contains connections in both directions, and it
 * is built from forwardConnections.
 */
function buildAllConnections(forwardConnections) {
    const result = new Set();
    for (const connection of forwardConnections) {
        // Reversing a connection is just swapping the first and second halve.
        const reversed = connection.slice(2) + connection.slice(0, 2);
        result.add(connection);
        result.add(reversed);
    }
    return result;
}

const allConnections = buildAllConnections(forwardConnections);

const appElement = document.getElementById('app');
const app = new StarveTheFoxClient(appElement, { playerID: playerID });

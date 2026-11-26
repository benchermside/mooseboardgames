import { INVALID_MOVE } from 'boardgame.io/dist/cjs/core.js';


const startingBoard =
    "##F.F##" +
    "##...##" +
    "......." +
    "SSSSSSS" +
    "SSSSSSS" +
    "##SSS##" +
    "##SSS##";


export const StarveTheFox = {

    name: "StarveTheFox",

    setup: () => ({
        board: Array.from(startingBoard),
        currentMoveStart: null,
    }),

    moves: {
        /** Lift one of your pieces (to place it elsewhere). */
        liftPiece: ({G, playerID}, spaceId) => {
            const myPieceCode = pieceCode(playerID);
            if (G.currentMoveStart !== null || G.board[spaceId] !== myPieceCode) {
                return INVALID_MOVE;
            }
            G.board[spaceId] = ".";
            G.currentMoveStart = spaceId;
        },

        /** Place down a piece that is currently lifted. */
        placePiece: ({G, playerID, events}, spaceId) => {
            if (G.currentMoveStart === null) {
                return INVALID_MOVE;
            }
            if (G.currentMoveStart === spaceId) { // cancel move
                G.board[spaceId] = pieceCode(playerID);
                G.currentMoveStart = null;
            }
            if (isValidTarget(G, spaceId)) { // complete a move
                G.board[spaceId] = pieceCode(playerID);
                G.currentMoveStart = null;
                events.endTurn();
            }
        },
    }
}

function pieceCode(playerID) {
    switch(playerID) {
        case "0": return "F";
        case "1": return "S";
        default: console.assert(false, "Invalid playerID"); return null;
    }
}

/**
 * Given the state of the game and a spaceId this returns true if the spaceCode
 * is a valid place to move to.
 */
export function isValidTarget(G, spaceId) {
    // Nothing is valid if we aren't moving
    if (G.currentMoveStart === null) {
        return false;
    }
    // Reject invalid spaceIds
    if (spaceId < 0 || spaceId >= 49) {
        return false;
    }
    // Cannot move to an occupied space
    if (G.board[spaceId] !== ".") {
        return false;
    }
    // Can move to adjacent spaces
    const start = G.currentMoveStart;
    const connection = spaceIdMap.get(start) + spaceIdMap.get(spaceId);
    if (allConnections.has(connection)) {
        return true;
    }
    // Jumps
    return false; // FIXME: Not handled yet -- it doesn't allow jumps.
}

/** Creates spaceIdMap that maps from spaceId to [x,y] coordinate. */
function buildSpaceIdMap() {
    const result = new Map();
    let spaceId = 0;
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            if (isValidSpace([col, row])) {
                result.set(spaceId, `${col}${row}`);
            }
            spaceId = spaceId + 1;
        }
    }
    return result;
}

export const spaceIdMap = buildSpaceIdMap();

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
export const forwardConnections = buildForwardConnections();

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

/** Returns true if this is the [x,y] address of a valid space. */
function isValidSpace([c,r]) {
    return r >= 0 && r < 7 && c >= 0 && c < 7 &&
        ((r > 1 && r < 5) || (c > 1 && c < 5));
}

/** Returns true if these two [x,y] spaces both exist and are connected. */
export function connected([c1,r1], [c2,r2]) {
    return allConnections.has(`${c1}${r1}${c2}${r2}`);
}

// FIXME: Someday, worry about which queries are being run most often and make sure those are efficient
//   instead of converting back and forth between spaceId and [x,y]. Right now I have THREE different
//   formats: [x,y] (an array of 2 numbers), spaceId (a single number), and "xy" (a string with 2
//   digits). I should NOT be switching back and forth randomly between these... I should use one of
//   them consistently across the system. But right now I'm not certain which one. Maybe "xy" (which
//   is the format I am NOT using much of anywhere right now!!). HOWEVER, for now I'm making it work
//   so I'll save this for a refactoring pass.

/** Returns true if these two spaceIds both exist and are connected. */
export function connectedSpaceId(spaceId1, spaceId2) {
    let coord1 = spaceIdMap.get(spaceId1);
    let coord2 = spaceIdMap.get(spaceId2);
    if (coord1 === undefined || coord2 === undefined) {
        return false;
    }
    let connection = coord1 + coord2;
    return allConnections.has(connection);
}

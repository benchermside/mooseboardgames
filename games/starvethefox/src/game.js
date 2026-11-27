import { INVALID_MOVE } from 'boardgame.io/dist/cjs/core.js';


export const StarveTheFox = {

    name: "StarveTheFox",

    setup: () => ({
        board: buildStartingBoard(), // maps spaceId to "F", "S", or "."
        currentMoveStart: null, // null OR the spaceId where the lifted piece started
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
 * Given the state of the game and a spaceId this returns true if the spaceId
 * is a valid place to move to.
 */
export function isValidTarget(G, spaceId) {
    // Nothing is valid if we aren't moving
    if (G.currentMoveStart === null) {
        return false;
    }
    // Cannot move to an occupied space (or an invalid space)
    if (G.board[spaceId] !== ".") {
        return false;
    }
    // CAN move to adjacent spaces
    if (allConnections.has(G.currentMoveStart + spaceId)) {
        return true;
    }
    // If it's a Fox, can move to a jump location if it's clear and there's a sheep to jump
    return false; // FIXME: Not handled yet -- it doesn't allow jumps.
}


/** Function to create the allSpaces constant. */
function buildAllSpaces() {
    const result = new Set();
    for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
            if (y >= 0 && y < 7 && x >= 0 && x < 7 && ((y > 1 && y < 5) || (x > 1 && x < 5))) {
                result.add(`${x}${y}`);
            }
        }
    }
    return result;
}

/** Returns a Set of the valid spaceIds. */
export const allSpaces = buildAllSpaces();

/** Returns true if this is the "xy" address of a valid space on the board. */
function isValidSpaceId(spaceId) {
    return allSpaces.has(spaceId);
}

/**
 * Creates the object mapping from spaceKey ("xy") to status ("F", "S", ".") for the
 * starting board.
 */
function buildStartingBoard() {
    const layout =
        "##F.F##" +
        "##...##" +
        "......." +
        "SSSSSSS" +
        "SSSSSSS" +
        "##SSS##" +
        "##SSS##";
    const result = {};
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            const spaceId = `${col}${row}`;
            if (isValidSpaceId(spaceId)) {
                result[spaceId] = layout[row * 7 + col];
            }
        }
    }
    return result;
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
            const spaceId = `${x}${y}`;
            if (!isValidSpaceId(spaceId)) continue;
            for (const { dx, dy, diagonal } of DIRECTIONS) {
                const x2 = x + dx;
                const y2 = y + dy;
                const spaceId2 = `${x2}${y2}`;
                if (!isValidSpaceId(spaceId2)) continue;
                if (diagonal && (x + y) % 2 !== 0) continue;
                result.add(spaceId + spaceId2);
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

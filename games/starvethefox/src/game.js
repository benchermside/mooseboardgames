import { INVALID_MOVE } from 'boardgame.io/dist/cjs/core.js';


export const StarveTheFox = {

    name: "StarveTheFox",

    setup: () => ({
        board: buildStartingBoard(), // maps spaceId to "F", "S", or "."
        currentMoveStart: null, // null OR the spaceId where the lifted piece started
        prevProgressTurn: 0, // number of the last turn in which a sheep made progress
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
        placePiece: ({G, ctx, playerID, events}, spaceId) => {
            if (G.currentMoveStart === null) {
                return INVALID_MOVE;
            }
            if (G.currentMoveStart === spaceId) { // cancel move
                G.board[spaceId] = pieceCode(playerID);
                G.currentMoveStart = null;
            }
            const allowedMove = allowedMoveTo(G, playerID, spaceId);
            if (allowedMove !== null) { // complete a move
                G.board[spaceId] = pieceCode(playerID);
                if (allowedMove.jumped !== null) {
                    G.board[allowedMove.jumped] = ".";
                }
                if (allowedMove.progress) {
                    G.prevProgressTurn = ctx.turn;
                }
                G.currentMoveStart = null;
                trappedFoxesDie(G);
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
 * With board state G and active player playerID, this returns information about
 * moving from startSpaceId to endSpaceId. It does NOT check whether there is a
 * piece of the right player on startSpaceId (or, indeed, a piece at all) on the
 * start space. It returns null if a move from the current playerID from that start
 * space to the end space would not be legal. If such a move WOULD be legal, this
 * returns a data structure with two fields: "jumped" which is either null, or is
 * the spaceId of a place where a piece gets jumped, and "progress" which is true
 * if a sheep moves forward and false if not.
 */
function legalMove(G, playerID, startSpaceId, endSpaceId) {
    // Sheep and Foxes move differently:
    if (playerID === "0") { // Fox moving
        // Must move to empty space
        if (G.board[endSpaceId] !== ".") {
            return null;
        }
        // Can move to a connected space
        if (allConnections.has(startSpaceId + endSpaceId)) {
            return {jumped: null, progress: false};
        }
        // Can jump if there's a sheep in the middle
        const mid = allJumps.get(startSpaceId + endSpaceId);
        if (mid !== undefined && G.board[mid] === 'S') {
            return {jumped: mid, progress: false};
        }
    } else { // Sheep moving
        // Must move to empty space
        if (G.board[endSpaceId] !== ".") {
            return null;
        }
        // Can move to a connected space if it's not backward
        const upDistance = Number(startSpaceId[1]) - Number(endSpaceId[1]);
        if (upDistance >= 0 && allConnections.has(G.currentMoveStart + endSpaceId)) {
            return {jumped: null, progress: upDistance > 0};
        }
    }
    return null;
}

/**
 * With board state G and active player playerID, this returns information about
 * moving to spaceId. If such a move would not be legal, this returns null. If
 * such a move IS legal, this returns a data structure with two fields: "jumped"
 * which is either null, or is the spaceId of a place where a piece gets jumped,
 * and "progress" which is true if a sheep moves forward and false if not.
 *
 * @param G
 * @param playerID
 * @param spaceId
 */
function allowedMoveTo(G, playerID, spaceId) {
    // Nothing is valid if we haven't lifted up a piece
    if (G.currentMoveStart === null) {
        return null;
    }
    return legalMove(G, playerID, G.currentMoveStart, spaceId);
}

/**
 * Given the state of the game and a spaceId this returns true if the spaceId
 * is a valid place to move to.
 */
export function isValidTarget(G, playerID, spaceId) {
    return allowedMoveTo(G, playerID, spaceId) !== null;
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
    allSpaces.forEach(spaceId => {
        const x = Number(spaceId[0]);
        const y = Number(spaceId[1]);
        result[spaceId] = layout[y * 7 + x];
    });
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
    allSpaces.forEach(spaceId => {
        const x = Number(spaceId[0]);
        const y = Number(spaceId[1]);
        for (const { dx, dy, diagonal } of DIRECTIONS) {
            const x2 = x + dx;
            const y2 = y + dy;
            const spaceId2 = `${x2}${y2}`;
            if (!allSpaces.has(spaceId2)) continue;
            if (diagonal && (x + y) % 2 !== 0) continue;
            result.add(spaceId + spaceId2);
        }
    });
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

function buildAllJumps() {
    const result = new Map();
    allSpaces.forEach(spaceId1 => {
        const x = Number(spaceId1[0]);
        const y = Number(spaceId1[1]);
        for (const { dx, dy, diagonal } of DIRECTIONS) {
            const spaceId2 = `${(x + 2 * dx)}${(y + 2 * dy)}`;
            if (!allSpaces.has(spaceId2)) continue;
            if (diagonal && (x + y) % 2 !== 0) continue;
            const spaceIdMid = `${x + dx}${y + dy}`;
            result.set(spaceId1 + spaceId2, spaceIdMid);
            result.set(spaceId2 + spaceId1, spaceIdMid);
        }
    });
    return result;
}

// A Map from "{start}{end}" to "space-jumped-over".
const allJumps = buildAllJumps();

/**
 * When called, this checks whether each fox can move. If any fox cannot
 * move, that fox is eliminated from the board.
 */
function trappedFoxesDie(G) {
    let foxesToDie = [];
    allSpaces.forEach(spaceId1 => {
        if (G.board[spaceId1] === "F") {
            let foxCanMove = false; // until we find one
            allSpaces.forEach(spaceId2 => {
                if (legalMove(G, "0", spaceId1, spaceId2) !== null) {
                    foxCanMove = true;
                }
            });
            if (!foxCanMove) {
                foxesToDie.push(spaceId1);
            }
        }
    });
    foxesToDie.forEach(spaceId => {
        G.board[spaceId] = ".";
    });
}

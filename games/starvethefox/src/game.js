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
    }),

    moves: {
        /* Remove a piece that's currently on a space. */
        removePiece: ({G, playerID}, id) => {
            if (!["F","S"].includes(G.board[id])) {
                return INVALID_MOVE;
            }
            G.board[id] = ".";
        },

        /* Place this player's piece on an open space. */
        placePiece: ({G, playerID}, id) => {
            if (G.board[id] !== ".") {
                return INVALID_MOVE;
            }
            G.board[id] = pieceCode(playerID);
        }
    }
}


function pieceCode(playerID) {
    switch(playerID) {
        case "0": return "F";
        case "1": return "S";
        default: console.assert(false, "Invalid playerID"); return null;
    }
}

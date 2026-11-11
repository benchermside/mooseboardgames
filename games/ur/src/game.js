import { INVALID_MOVE } from 'boardgame.io/dist/cjs/core.js';
export const Ure = {
  name: "ur",
  setup: () => (
    { //Keeps track of the spaces in a list. 
        board: Array(15).fill(null).map(() => ({ "0": false, "1": false })),
        step: "rolling", //"rolling" or "moving"
        "0": {// Player specific information 
            dice: Array(4).fill(null), //Most recent dice results
            roll: null,                //Most recent number rolled
            remainingPieces: 7,        //Number of unplaced pieces
            finishedPieces: 0,         //Number of Pieces that have escaped
            otherPlayer: "1",    //ID of the other player
        },
        "1": {
            dice: Array(4).fill(null),
            roll: null,
            remainingPieces: 7,
            finishedPieces: 0,
            otherPlayer: "0",
        },
    }),
    endIf: ({ G, ctx }) => {
        const currentPlayer = ctx.currentPlayer;
        if (G[currentPlayer].finishedPieces >= 7){
            return { winner: ctx.currentPlayer };
        }
    },
    moves: {
        clickCell: ({ G, playerID, events }, destination, row) => {
            if (G.step != "moving"){
                return INVALID_MOVE;
            }
            // The top row ("t") belongs to player 1 and the bottom row ("b") to player 0.
            // The middle row ("m") is shared.
            if ((row === "t" && playerID !== "1") || (row === "b" && playerID !== "0")){
                return INVALID_MOVE;
            }
            const otherPlayer = G[playerID].otherPlayer;
            const start = destination - G[playerID].roll;
            if (destination > 14 || start < -1){
                return INVALID_MOVE;
            }
            else if (G.board[destination][playerID] == true){
                return INVALID_MOVE;
            }
            else if (start != -1 && G.board[start][playerID] == false){
                return INVALID_MOVE;
            }
            else if (destination == 7 && G.board[destination][otherPlayer] == true){
                return INVALID_MOVE;
            } 
            else if (start == -1 && G[playerID].remainingPieces <= 0){
                return INVALID_MOVE;
            }
            else {
                //Move is valid
                if (start == -1){
                    G[playerID].remainingPieces = G[playerID].remainingPieces - 1;                    
                } 
                else{
                    G.board[start][playerID] = false;
                }
                if (destination == 14){
                    G[playerID].finishedPieces += 1;
                } else {
                    if(G.board[destination][otherPlayer] == true && (4 <= destination  && destination <= 11)){
                        G.board[destination][otherPlayer] = false;
                        G[otherPlayer].remainingPieces += 1;
                    }
                    G.board[destination][playerID] = true;
                }
                if (!(destination == 3 || destination == 7 || destination == 13)){
                    events.endTurn();
                }
                G.step = "rolling";
                return;
            }
        },
        roll: ({G, playerID, events, random }, rollingPlayer) => {
            if (G.step != "rolling"){
                return INVALID_MOVE;
            }
            // Reject a roll made with the opponent's button.
            if (rollingPlayer !== playerID){
                return INVALID_MOVE;
            }
            G[playerID].roll = 0;
            for (let i=0; i < 4; i++){
                G[playerID].dice[i] = random.Die(2) - 1;
                G[playerID].roll += G[playerID].dice[i];
            }
            if (validMoveExists(G, playerID)){
                G.step = "moving";
            }
            else{
                events.endTurn();
            }
        },
    },
  
};

function validMoveExists(G, playerID){
    const moveSize = G[playerID].roll;
    const otherPlayer = G[playerID].otherPlayer;
    if (moveSize === 0){
        return false;
    }
    if ((!G.board[moveSize - 1][playerID]) && G[playerID].remainingPieces > 0){
        return true;
    }
    for (let i=0; i <= 14-moveSize; i++){
        if (G.board[i][playerID] === true){
            if (i + moveSize === 7){
                if (G.board[i + moveSize][playerID] == false && G.board[i + moveSize][otherPlayer] === false){
                    return true;
                }
            }
            else if (G.board[i + moveSize][playerID] == false){
                return true;
            }
        }
    }
    return false
}
import { Client } from 'boardgame.io/client';
import { Ure } from './game';
import { SocketIO } from 'boardgame.io/multiplayer'

class UreClient {
    constructor(rootElement, { playerID } = {}) {
        this.client = Client({ 
            game: Ure,
            multiplayer: SocketIO({ server: 'localhost:8001' }),
            playerID,        
        });
        this.client.start();
        this.rootElement = rootElement;
        this.createBoard();
        this.attachListeners();
        this.client.subscribe(state => this.update(state));
    }
    createBoard() {
        const rows = [[], [], []];
        // Hidden circles for each player's pieces; show one by removing its "hidden" class.
        const redCircle = `<div class="piece red hidden"></div>`;
        const blueCircle = `<div class="piece blue hidden"></div>`;
        for (let i=12; i != 4; i = (i + 1)%16){
            if (i === 14){
                
                rows[0].push(`<td class="cell empty clickable" data-id="${i.toString() + "t"}"></td>`);
                rows[2].push(`<td class="cell empty clickable" data-id="${i.toString() + "b"}"></td>`);
            }
            else if (i === 15){
                rows[0].push(`<td class="cell empty" data-id="${i.toString() + "t"}"></td>`);
                rows[2].push(`<td class="cell empty" data-id="${i.toString() + "b"}"></td>`);                
            }
            else {
                rows[0].push(`<td class="cell clickable" data-id="${i.toString() + "t"}">${redCircle}</td>`);
                rows[2].push(`<td class="cell clickable" data-id="${i.toString() + "b"}">${blueCircle}</td>`);
            }
        }

        for (let i=11; i > 3; i = i - 1){
            rows[1].push(`<td class="cell clickable" data-id="${i.toString()}">${redCircle}${blueCircle}</td>`);
        }
        for (let i = 0; i < 3; i++) {
            rows[i] = `<tr>${rows[i].join('')}</tr>`;
        }

        this.rootElement.innerHTML = `
        <div class="playArea">
            <div class="above">
                <div class="CoinsHolder">
                    <div class="coin red" data-id="coinP1N0"></div>
                    <div class="coin red" data-id="coinP1N1"></div>
                </div>
                <div class="CoinsHolder">
                    <div class="coin red" data-id="coinP1N2"></div>
                    <div class="coin red" data-id="coinP1N3"></div>
                </div>
                <button class="rollButton" data-id="1roll">roll</button>
            </div>
            <table>${rows.join('')}</table>
            <div class="below">
                <div class="CoinsHolder">
                    <div class="coin red" data-id="coinP0N0"></div>
                    <div class="coin red" data-id="coinP0N1"></div>
                </div>
                <div class="CoinsHolder">
                    <div class="coin red" data-id="coinP0N2"></div>
                    <div class="coin red" data-id="coinP0N3"></div>
                </div>
                <button class="rollButton" data-id="0roll">roll</button>
            </div>
            <p class="winner"></p>
        </div>
        `;
    }
    attachListeners() {
        // This event handler will read the cell id from a cell’s
        // `data-id` attribute and make the `clickCell` move.
        const handleCellClick = event => {
            const cellId = event.currentTarget.dataset.id;
            const id = parseInt(cellId);
            // "t" for the top row, "b" for the bottom row, "m" for the middle row.
            const lastChar = cellId.charAt(cellId.length - 1);
            const row = (lastChar === "t" || lastChar === "b") ? lastChar : "m";
            this.client.moves.clickCell(id, row);
        };
        // Attach the event listener to each of the board cells.
        const cells = this.rootElement.querySelectorAll('.clickable');
        cells.forEach(cell => {
            cell.onclick = handleCellClick;
        });
        // Each roll button's data-id starts with the player it rolls for ("0roll" or "1roll").
        this.rootElement.querySelectorAll(".rollButton").forEach(button => {
            button.onclick = event => {
                const rollingPlayer = event.currentTarget.dataset.id.charAt(0);
                this.client.moves.roll(rollingPlayer);
            };
        });
    }
    update(state) {
        if (state === null) {
            return;
        }
        const cells = this.rootElement.querySelectorAll('.cell');
        cells.forEach(cell => {
            const cellId = cell.dataset.id;
            const row = cellId.charAt(cellId.length - 1);
            if (!cell.classList.contains("empty")){
                let cellIdInt;
                if (row === "t"){
                    cellIdInt = parseInt(cellId.substring(0, cellId.length - 1));
                    if (state.G.board[cellIdInt]["1"]){
                        cell.firstElementChild.classList.remove("hidden");
                    }
                    else{
                        cell.firstElementChild.classList.add("hidden");
                    }
                }
                else if (row === "b"){
                    cellIdInt = parseInt(cellId.substring(0, cellId.length - 1));
                    if (state.G.board[cellIdInt]["0"]){
                        cell.firstElementChild.classList.remove("hidden");
                    }
                    else{
                        cell.firstElementChild.classList.add("hidden");
                    }
                }
                else {
                    cellIdInt = parseInt(cellId);
                    if (state.G.board[cellIdInt]["1"]){
                        cell.firstElementChild.classList.remove("hidden");
                    }
                    else{
                        cell.firstElementChild.classList.add("hidden");
                    }
                    if (state.G.board[cellIdInt]["0"]){
                        cell.lastElementChild.classList.remove("hidden");
                    }
                    else{
                        cell.lastElementChild.classList.add("hidden");
                    }
                }
            }
        });
        const coins = this.rootElement.querySelectorAll('.coin');
        coins.forEach(coin => {
            const coinID = coin.dataset.id;
            const coinPlayer = coinID.charAt(5);
            const coinNumber = parseInt(coinID.charAt(7));
            const coinResult = state.G[coinPlayer].dice[coinNumber];
            if (coinResult === 1){
                coin.style.backgroundColor = "#83f70e";
                coin.innerHTML = "1";
            }
            else if(coinResult === 0){
                coin.style.backgroundColor = "#db1118";
                coin.innerHTML = "0";
            }
            else if(coinResult === null){
                coin.style.backgroundColor = "#db1118";
                coin.innerHTML = "0";
            }
        });

    }
}
// http://localhost:1234/?player=0
// http://localhost:1234/?player=1
const params = new URLSearchParams(window.location.search);
const playerID = params.get("player");   // "0", "1", or null
const appElement = document.getElementById('app');
const app = new UreClient(appElement, { playerID: playerID });

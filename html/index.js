// Page logic for index.html: shows the list of open games, and switches to
// the starting-game lobby when the user joins one.
//
// Relies on callAPI.js having been loaded first.


// The open-game JSON for the game whose lobby is showing, or null while the
// list of open games is showing.
let selectedOpenGame = null;


/**
 * The name to show the user for an open game.
 */
function gameDisplayName(openGame) {
    return openGame.game_name;
}


/**
 * Build the element for one open game, from the open-game-template in
 * index.html.
 */
function makeOpenGameElement(openGame) {
    const template = document.getElementById("open-game-template");
    const element = template.content.firstElementChild.cloneNode(true);
    const joinedCount = openGame.joined_users.length;
    const playerCount = openGame.parsed_settings.playerCount;
    element.querySelector(".game-name").textContent = gameDisplayName(openGame);
    element.querySelector(".player-count").textContent = `${joinedCount} of ${playerCount} Players`;
    element.querySelector("button").addEventListener("click", () => joinGame(openGame));
    return element;
}


/**
 * Fetch the open games from the API and show one entry for each.
 */
async function showOpenGames() {
    const container = document.getElementById("open-games");
    const response = await getOpenGames();
    if (!response.ok) {
        container.textContent = `Could not load open games: ${response.body?.error ?? response.status}`;
        return;
    }
    // The API sends settings as a JSON-encoded string; decode it once here
    // into a new parsed_settings field.
    const openGames = response.body.map(openGame => ({...openGame, parsed_settings: JSON.parse(openGame.settings)}));
    container.replaceChildren(...openGames.map(makeOpenGameElement));
}


/**
 * Join an open game through the API. If that works, switch to its lobby;
 * otherwise stay on the list and say why.
 */
async function joinGame(openGame) {
    const errorMessage = document.getElementById("join-game-error-message");
    const response = await joinOpenGame(openGame.open_game_id);
    if (!response.ok) {
        errorMessage.textContent = `Could not join game: ${response.body?.error ?? response.status}`;
        return;
    }
    if (response.body.message === "gameFull") {
        errorMessage.textContent = "That game is full.";
        return;
    }
    // "joined" or "alreadyInGame"
    errorMessage.textContent = "";
    showStartingGameLobby(openGame);
}


/**
 * Hide the list of open games and show the lobby for the given open game.
 */
function showStartingGameLobby(openGame) {
    selectedOpenGame = openGame;
    const lobby = document.getElementById("starting-game-lobby");
    lobby.querySelector(".game-name").textContent = gameDisplayName(openGame);
    document.getElementById("view-games-lobby").hidden = true;
    lobby.hidden = false;
}


showOpenGames();

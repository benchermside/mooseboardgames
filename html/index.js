// Page logic for index.html: shows the list of open games, and switches to
// the starting-game lobby when the user joins one.
//
// Relies on callAPI.js having been loaded first.


// All of the information about the current state of the lobby.
let lobbyState = {
    // The open-game JSON for the game whose lobby is showing, or null while the
    // list of open games is showing.
    selectedOpenGame: null
}


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
    const templateElem = document.getElementById("open-game-template");
    const elementElem = templateElem.content.firstElementChild.cloneNode(true);
    const joinedCount = openGame.joined_users.length;
    const playerCount = openGame.parsed_settings.playerCount;
    elementElem.querySelector(".game-name").textContent = gameDisplayName(openGame);
    elementElem.querySelector(".player-count").textContent = `${joinedCount} of ${playerCount} Players`;
    elementElem.querySelector("button").addEventListener("click", () => joinGame(openGame));
    return elementElem;
}


/**
 * Return a copy of an open game from the API with a parsed_settings field
 * added. The API sends settings as a JSON-encoded string; parsed_settings is
 * that string decoded.
 */
function withParsedSettings(openGame) {
    return {...openGame, parsed_settings: JSON.parse(openGame.settings)};
}


/**
 * Fetch the open games from the API and show one entry for each.
 */
async function showOpenGames() {
    const containerElem = document.getElementById("open-games");
    const response = await getOpenGames();
    if (!response.ok) {
        containerElem.textContent = `Could not load open games: ${response.body?.error ?? response.status}`;
        return;
    }
    const openGames = response.body.map(withParsedSettings);
    containerElem.replaceChildren(...openGames.map(makeOpenGameElement));
}


/**
 * Join an open game through the API. If that works, switch to its lobby;
 * otherwise stay on the list and say why.
 */
async function joinGame(openGame) {
    const errorMessageElem = document.getElementById("join-game-error-message");
    const response = await joinOpenGame(openGame.open_game_id);
    if (!response.ok) {
        errorMessageElem.textContent = `Could not join game: ${response.body?.error ?? response.status}`;
        return;
    }
    if (response.body.message === "gameFull") {
        errorMessageElem.textContent = "That game is full.";
        return;
    }
    // "joined" or "alreadyInGame"

    // openGame was fetched before we joined, so re-fetch to get a copy whose
    // joined_users includes us. FIXME: It would be better to fetch info about the
    // open game itself OR to have the joinOpenGame command return it.
    const gamesResponse = await getOpenGames();
    if (!gamesResponse.ok) {
        errorMessageElem.textContent = `Could not load the joined game: ${gamesResponse.body?.error ?? gamesResponse.status}`;
        return;
    }
    const joinedGame = gamesResponse.body.find(game => game.open_game_id === openGame.open_game_id);
    if (joinedGame === undefined) {
        errorMessageElem.textContent = "That game no longer exists.";
        return;
    }
    errorMessageElem.textContent = "";
    showStartingGameLobby(withParsedSettings(joinedGame));
}


/**
 * Build the element for one player slot in the lobby, from the
 * player-view-template in index.html. text is what to show in it.
 */
function makePlayerViewElement(player) {
    const templateElem = document.getElementById("player-view-template");
    const elementElem = templateElem.content.firstElementChild.cloneNode(true);
    elementElem.textContent = player;
    return elementElem;
}


/**
 * Hide the list of open games and show the lobby for the given open game.
 */
function showStartingGameLobby(openGame) {
    lobbyState.selectedOpenGame = openGame;
    const lobbyElem = document.getElementById("starting-game-lobby");
    lobbyElem.querySelector(".game-name").textContent = gameDisplayName(openGame);

    // One slot per joined user, then "not joined" slots up to playerCount.
    const players = [...openGame.joined_users];
    while (players.length < openGame.parsed_settings.playerCount) {
        players.push("not joined");
    }
    document.getElementById("player-views").replaceChildren(...players.map(makePlayerViewElement));

    // Swap the display
    document.getElementById("view-games-lobby").hidden = true;
    lobbyElem.hidden = false;
}


showOpenGames();

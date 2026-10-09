// Page logic for index.html: fills in the list of open games.
//
// Relies on callAPI.js having been loaded first.


/**
 * Build the element for one open game, from the open-game-template in
 * index.html.
 */
function makeOpenGameElement(openGame) {
    const template = document.getElementById("open-game-template");
    const element = template.content.firstElementChild.cloneNode(true);
    const joinedCount = openGame.joined_users.length;
    const playerCount = openGame.settings.playerCount;
    element.querySelector(".game-name").textContent = openGame.game_name;
    element.querySelector(".player-count").textContent = `${joinedCount} of ${playerCount} Players`;
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
    container.replaceChildren(...response.body.map(makeOpenGameElement));
}


showOpenGames();

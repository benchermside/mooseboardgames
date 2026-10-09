// Browser-side wrappers for the siteAPI lambda endpoints.
//
// Every function here returns a promise for a {ok, status, body} object, where
// body is the parsed JSON the API sent back. Error statuses are NOT thrown --
// the caller checks ok (or status) and decides what to do about them. On an
// error the lambda puts a human-readable message in body.error.

// When the page is served locally (see local/README.md), talk to the local
// gateway; otherwise talk to the real API (no trailing slash).
// FIXME: point the non-local URL at the real API Gateway URL.
const API_BASE_URL = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "https://example.execute-api.us-east-1.amazonaws.com";


/**
 * Make one call to the API and return {ok, status, body}.
 *
 * path is appended to API_BASE_URL (it should start with "/"). body, if given,
 * is JSON-encoded and sent as the request body. The session cookie is sent
 * along automatically because of credentials: "include".
 *
 * An error status is reported, not thrown: ok is false, status is the HTTP
 * status code, and body.error is the message the lambda returned. Only a
 * network failure, or a body that isn't valid JSON, rejects.
 */
async function callAPI(method, path, body) {
    const options = {
        method: method,
        credentials: "include",  // send the cookie_id cookie
    };
    if (body !== undefined) {
        options.headers = {"Content-Type": "application/json"};
        options.body = JSON.stringify(body);
    }

    const response = await fetch(API_BASE_URL + path, options);

    // A body is expected on every route, but don't blow up on an empty one.
    const text = await response.text();
    let parsed = null;
    if (text !== "") {
        try {
            parsed = JSON.parse(text);
        } catch (exc) {
            throw new Error(`API returned a body that isn't JSON: ${text}`);
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        body: parsed,
    };
}


/**
 * Get the list of all open games.
 *
 * On success body is a list of open-game objects, each with open_game_id,
 * game_name, settings, joined_users, and owner_user_id.
 */
async function getOpenGames() {
    return await callAPI("GET", "/open-games");
}


/**
 * Start a new open game, with the caller as its owner and only joined user.
 *
 * gameName is the enum naming which game it is; settings is that game's
 * settings JSON (it must include playerCount). On success body is
 * {open_game_id}.
 */
async function createOpenGame(gameName, settings) {
    return await callAPI("POST", "/open-games", {
        game_name: gameName,
        settings: settings,
    });
}


/**
 * Delete an open game. Only the game's owner may do this.
 *
 * On success body is {message}. If the caller doesn't own the game the API
 * answers 401 and body.error explains why.
 */
async function deleteOpenGame(openGameId) {
    return await callAPI("DELETE", `/open-games/${encodeURIComponent(openGameId)}`);
}


/**
 * Join an open game.
 *
 * On success body is {message}, where message is "joined", "alreadyInGame",
 * or "gameFull".
 */
async function joinOpenGame(openGameId) {
    return await callAPI("PUT", `/open-games/${encodeURIComponent(openGameId)}`);
}


/**
 * Leave an open game you had joined.
 *
 * On success body is {message}, where message is "left" or "notInGame". The
 * API answers 400 if the caller is the game's owner, since owners delete
 * their game instead of leaving it.
 */
async function leaveOpenGame(openGameId) {
    return await callAPI("PUT", `/open-games/leave/${encodeURIComponent(openGameId)}`);
}

// Put a match into storage under a match ID and credentials chosen by someone
// else (the lobby, eventually), instead of letting boardgame.io's Lobby API
// make them up.
import { createMatch } from 'boardgame.io/dist/cjs/internal.js';

/**
 * credentials: { "0": "secret0", "1": "secret1", ... }, one entry per seat.
 * The number of entries is the number of players.
 */
export async function seedMatch(db, game, matchID, credentials) {
    const numPlayers = Object.keys(credentials).length;
    const match = createMatch({ game, numPlayers });
    if (match.setupDataError !== undefined) {
        throw new Error(`Bad setup data: ${match.setupDataError}`);
    }
    const { metadata, initialState } = match;
    for (const [playerID, secret] of Object.entries(credentials)) {
        // Giving a seat credentials is what makes boardgame.io check them.
        metadata.players[playerID].name = `Player ${playerID}`;
        metadata.players[playerID].credentials = secret;
    }
    await db.createMatch(matchID, { initialState, metadata });
}

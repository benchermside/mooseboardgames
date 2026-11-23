// Put a match into storage under the match ID and credentials the lobby chose,
// instead of letting boardgame.io's Lobby API make them up.
import { createMatch } from 'boardgame.io/dist/cjs/internal.js';

/**
 * match: what parseMatchRecord returns (numPlayers, setupData, credentials).
 */
export async function seedMatch(db, game, matchID, { numPlayers, setupData, credentials }) {
    const created = createMatch({ game, numPlayers, setupData });
    if (created.setupDataError !== undefined) {
        throw new Error(`Bad setup data: ${created.setupDataError}`);
    }
    const { metadata, initialState } = created;
    for (const [playerID, secret] of Object.entries(credentials)) {
        // Giving a seat credentials is what makes boardgame.io check them.
        metadata.players[playerID].credentials = secret;
    }
    await db.createMatch(matchID, { initialState, metadata });
}

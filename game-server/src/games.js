// Every game the server can host, by the game_name stored on a match record.
// One image serves every game (design D8), so add new games here.
//
// Each entry has:
//   game           the boardgame.io game object
//   idleTimeoutMs  how long a match may go without a move before it ends
//                  ABANDONED. Give games with long turns a longer one.
//   maxLifetimeMs  the longest a match may run at all, however active. The
//                  server ends it ABANDONED at that point, and records the
//                  deadline as expires_at so the reaper can stop a hung task.
// Set both for every game. The defaults below are only a fallback.
import { Ure } from '../../games/ur/src/game.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const DEFAULT_IDLE_TIMEOUT_MS = 15 * MINUTE;
export const DEFAULT_MAX_LIFETIME_MS = 4 * HOUR;

export const ALL_GAMES = [
    { game: Ure, idleTimeoutMs: 15 * MINUTE, maxLifetimeMs: 4 * HOUR },
];

/** game name -> { game, idleTimeoutMs, maxLifetimeMs }. The key is the game's own `name`. */
export const GAMES = Object.fromEntries(ALL_GAMES.map(entry => [
    entry.game.name,
    { idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS, maxLifetimeMs: DEFAULT_MAX_LIFETIME_MS, ...entry },
]));

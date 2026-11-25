// Design T7 and T8: decide when the match is over, record how it ended, and
// shut the server down. The task stops when the process exits.
//
//   waiting ──every seat connected──▶ playing ──game over──▶ ending (grace) ──▶ stopped
//      │                                │
//      └─ waiting room times out        └─ no moves for the idle timeout
//         (CANCELLED)                      (ABANDONED)
//
// Separately, reaching the game's maximum lifetime ends the match ABANDONED
// in any phase, unless it has already ended.
//
// A stop signal (SIGTERM, from StopTask) at any point records an ending if
// none is recorded yet (CANCELLED while waiting, ABORTED while playing) and
// exits at once.
import { log as defaultLog } from './log.js';

import { DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_MAX_LIFETIME_MS } from './games.js';

export const DEFAULT_TIMEOUTS = {
    waitingRoomMs: 15 * 60_000,
    // These two are normally each game's own (games.js); host.js passes them in.
    idleMs: DEFAULT_IDLE_TIMEOUT_MS,
    maxLifetimeMs: DEFAULT_MAX_LIFETIME_MS,
    gameOverGraceMs: 30_000,
};

export class MatchLifecycle {
    /**
     * table: has setStatus(matchID, status, { result }), normally a MatchTable.
     * storage: the ActivityStorage, whose events drive the lifecycle.
     * stopServer(): stops accepting connections.
     * exit(code): ends the process (process.exit, or a stub in tests).
     * expiresAt: a Date, the end of the maximum lifetime. Defaults to
     *   timeouts.maxLifetimeMs from now.
     */
    constructor({ matchID, numPlayers, table, storage, stopServer, exit, timeouts = {}, expiresAt, log = defaultLog }) {
        this.matchID = matchID;
        this.numPlayers = numPlayers;
        this.table = table;
        this.storage = storage;
        this.stopServer = stopServer;
        this.exit = exit;
        this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
        this.expiresAt = expiresAt ?? new Date(Date.now() + this.timeouts.maxLifetimeMs);
        this.log = log;
        this.phase = 'new';
        this.timer = undefined;          // waiting room, idle, or grace period
        this.lifetimeTimer = undefined;
        this.stopRequested = false;
    }

    /** Call once the server is listening. Starts the waiting-room and lifetime clocks. */
    start() {
        this.phase = 'waiting';
        this.lifetimeTimer = setTimeout(
            () => this.#end('ABANDONED', 'reached the game\'s maximum lifetime'),
            Math.max(0, this.expiresAt.getTime() - Date.now()));
        this.#setTimer(this.timeouts.waitingRoomMs, () => this.#end('CANCELLED', 'the waiting room timed out'));
        this.storage.events.on('metadata', metadata => this.#onMetadata(metadata));
        this.storage.events.on('activity', () => this.#onActivity());
        this.storage.events.on('gameover', result => this.#onGameOver(result));
    }

    /** StopTask (SIGTERM): record an ending if there isn't one, and exit now. */
    onStopSignal() {
        this.log(`STOP SIGNAL in phase ${this.phase}`);
        this.stopRequested = true;
        if (this.phase === 'waiting') {
            this.#end('CANCELLED', 'stopped while waiting for players');
        } else if (this.phase === 'playing') {
            this.#end('ABORTED', 'stopped mid-game');
        } else if (this.phase === 'grace') {
            this.#shutdown(0);
        }
        // 'ending': the ending is being written; #end exits when it's done.
    }

    #onMetadata(metadata) {
        if (this.phase !== 'waiting') {
            return;
        }
        const seats = Object.values(metadata.players);
        if (seats.length === this.numPlayers && seats.every(seat => seat.isConnected)) {
            this.phase = 'playing';
            this.log('ALL SEATS CONNECTED');
            this.#resetIdleTimer();
            this.table.setStatus(this.matchID, 'IN_PROGRESS').then(
                written => {
                    if (!written) {
                        // The lobby ended the match (e.g. cancelled it) meanwhile.
                        this.log('match already ended elsewhere; shutting down');
                        this.#shutdown(0);
                    }
                },
                err => this.log(`could not set IN_PROGRESS: ${err.message}`),
            );
        }
    }

    #onActivity() {
        if (this.phase === 'playing') {
            this.#resetIdleTimer();
        }
    }

    #onGameOver(result) {
        if (this.phase === 'waiting' || this.phase === 'playing') {
            this.#end('ENDED', `game over: ${JSON.stringify(result)}`, { result, graceMs: this.timeouts.gameOverGraceMs });
        }
    }

    #resetIdleTimer() {
        this.#setTimer(this.timeouts.idleMs, () => this.#end('ABANDONED', 'no moves for the idle timeout'));
    }

    #setTimer(ms, callback) {
        clearTimeout(this.timer);
        this.timer = setTimeout(callback, ms);
    }

    /**
     * Record the ending, then exit, after graceMs unless a stop was requested.
     * The grace period lets players' clients receive the final state.
     */
    async #end(status, reason, { result, graceMs = 0 } = {}) {
        if (this.phase === 'ending' || this.phase === 'grace' || this.phase === 'stopped') {
            return;
        }
        this.phase = 'ending';
        clearTimeout(this.timer);
        clearTimeout(this.lifetimeTimer);
        this.log(`ENDING ${status}: ${reason}`);

        let exitCode = 0;
        try {
            const written = await this.table.setStatus(this.matchID, status, { result });
            if (!written) {
                this.log('match already ended elsewhere; keeping that ending');
            }
        } catch (err) {
            // The match isn't marked over, so the reaper will mark it ABORTED.
            this.log(`could not record ${status}: ${err.message}`);
            exitCode = 1;
        }

        if (this.stopRequested || graceMs === 0 || exitCode !== 0) {
            this.#shutdown(exitCode);
        } else {
            this.phase = 'grace';
            this.#setTimer(graceMs, () => this.#shutdown(0));
        }
    }

    #shutdown(code) {
        if (this.phase === 'stopped') {
            return;
        }
        this.phase = 'stopped';
        clearTimeout(this.timer);
        clearTimeout(this.lifetimeTimer);
        this.log(`EXITING with code ${code}`);
        this.stopServer();
        this.exit(code);
    }
}

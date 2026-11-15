// A thin wrapper around boardgame.io's InMemory storage that notices activity
// and the end of the game. This is the S3 spike of the T7 watchdog: it only
// records and reports, it never exits.
import { Async } from 'boardgame.io/dist/cjs/internal.js';

export class ActivityStorage extends Async {
    /**
     * inner: an InMemory store (boardgame.io doesn't export the class, so the
     *   caller takes the one Server() makes by default).
     * onActivity(matchID): called after every state write.
     * onGameOver(matchID, gameover): called once, the first time a written
     *   state has ctx.gameover set.
     */
    constructor(inner, { onActivity = () => {}, onGameOver = () => {} } = {}) {
        super();
        this.inner = inner;
        this.onActivity = onActivity;
        this.onGameOver = onGameOver;
        this.lastActivity = Date.now();
        this.writeCount = 0;
        this.gameover = undefined;
    }

    async connect() {
        await this.inner.connect();
    }

    async createMatch(matchID, opts) {
        await this.inner.createMatch(matchID, opts);
    }

    async setState(matchID, state, deltalog) {
        await this.inner.setState(matchID, state, deltalog);
        this.lastActivity = Date.now();
        this.writeCount += 1;
        this.onActivity(matchID);
        if (state.ctx.gameover !== undefined && this.gameover === undefined) {
            this.gameover = state.ctx.gameover;
            this.onGameOver(matchID, state.ctx.gameover);
        }
    }

    async setMetadata(matchID, metadata) {
        await this.inner.setMetadata(matchID, metadata);
    }

    async fetch(matchID, opts) {
        return this.inner.fetch(matchID, opts);
    }

    async wipe(matchID) {
        await this.inner.wipe(matchID);
    }

    async listMatches(opts) {
        return this.inner.listMatches(opts);
    }
}

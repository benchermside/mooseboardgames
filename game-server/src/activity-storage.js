// A thin wrapper around boardgame.io's InMemory storage that reports what the
// match lifecycle (lifecycle.js) needs to know, as events on `events`:
//   'activity'           after every state write (a move, or an event like endTurn)
//   'gameover' (result)  once, the first time a written state has ctx.gameover
//   'metadata' (meta)    after every metadata write. boardgame.io writes
//                        metadata when a player connects or disconnects, with
//                        metadata.players[seat].isConnected updated.
import { EventEmitter } from 'node:events';
import { Async } from 'boardgame.io/dist/cjs/internal.js';

export class ActivityStorage extends Async {
    /**
     * inner: an InMemory store (boardgame.io doesn't export the class, so the
     *   caller takes the one Server() makes by default).
     */
    constructor(inner) {
        super();
        this.inner = inner;
        this.events = new EventEmitter();
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
        this.events.emit('activity');
        if (state.ctx.gameover !== undefined && this.gameover === undefined) {
            this.gameover = state.ctx.gameover;
            this.events.emit('gameover', state.ctx.gameover);
        }
    }

    async setMetadata(matchID, metadata) {
        await this.inner.setMetadata(matchID, metadata);
        this.events.emit('metadata', metadata);
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

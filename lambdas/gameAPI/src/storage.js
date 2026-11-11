// boardgame.io storage adapter: lets boardgame.io's Master load and save
// matches through db (see db.js). Make a new one for each Lambda invocation.
import { Async } from 'boardgame.io/dist/cjs/internal.js';

export class MatchStorage extends Async {
    constructor(db) {
        super();
        this.db = db;
        // The state ID the client based its move on. The handler sets this
        // before Master.onUpdate, so setState can refuse to overwrite a move
        // that another invocation saved first.
        this.expectedStateID = undefined;
        // Master fetches the same match several times per call, so read it
        // once and reuse it. Safe because each instance serves one invocation.
        this.cachedMatch = undefined;
    }

    async connect() {}

    async fetch(matchID, opts) {
        if (this.cachedMatch === undefined) {
            this.cachedMatch = (await this.db.getMatch(matchID)) ?? null;
        }
        const match = this.cachedMatch;
        const result = {};
        if (match === null) {
            return result;
        }
        if (opts.state && match.state !== undefined) {
            result.state = JSON.parse(match.state);
        }
        if (opts.initialState && match.initial_state !== undefined) {
            result.initialState = JSON.parse(match.initial_state);
        }
        if (opts.metadata && match.metadata !== undefined) {
            result.metadata = JSON.parse(match.metadata);
        }
        if (opts.log) {
            // The game log isn't stored, to keep match rows small.
            result.log = [];
        }
        return result;
    }

    async createMatch(matchID, { initialState, metadata }) {
        await this.db.createMatchState(matchID, {
            stateJSON: JSON.stringify(initialState),
            stateID: initialState._stateID,
            initialStateJSON: JSON.stringify(initialState),
            metadataJSON: JSON.stringify(metadata),
        });
    }

    async setState(matchID, state) {
        if (this.expectedStateID === undefined) {
            throw new Error('MatchStorage.setState called without expectedStateID');
        }
        if (state._stateID === this.expectedStateID) {
            // The move was rejected (e.g. INVALID_MOVE), so nothing changed.
            return;
        }
        await this.db.setMatchState(matchID, {
            stateJSON: JSON.stringify(state),
            stateID: state._stateID,
        }, this.expectedStateID);
    }

    async setMetadata(matchID, metadata) {
        // Master saves metadata after every move just to bump updatedAt, which
        // nothing here uses. Only save when the game has just ended.
        const stored = this.cachedMatch?.metadata;
        const storedGameover = stored === undefined ? undefined : JSON.parse(stored).gameover;
        if (metadata.gameover === undefined || storedGameover !== undefined) {
            return;
        }
        await this.db.setMatchMetadata(matchID, JSON.stringify(metadata));
    }

    async wipe() {
        throw new Error('MatchStorage does not support wipe');
    }

    async listMatches() {
        throw new Error('MatchStorage does not support listMatches');
    }
}

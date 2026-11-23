// The match record: one item per match in the matches table, shared by the
// lobby, the orchestration Lambdas, the router, and this server.
// documentation/match-record.md describes every attribute and who writes it.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/** Statuses after which the match is over and nothing should serve it. */
export const TERMINAL_STATUSES = ['ENDED', 'ABANDONED', 'CANCELLED', 'ABORTED'];

/** A match record this server can't host. */
export class MatchRecordError extends Error {}

/**
 * Check the record the lobby wrote and turn it into what the server needs.
 * Throws MatchRecordError if it's missing or malformed.
 *
 * games: game name -> { game, idleTimeoutMs, maxLifetimeMs }, as in games.js.
 *
 * Returns { matchID, status, gameName, game, idleTimeoutMs, maxLifetimeMs,
 * numPlayers, setupData, credentials }.
 */
export function parseMatchRecord(matchID, item, games) {
    if (item === undefined) {
        throw new MatchRecordError(`No match record for ${matchID}`);
    }
    const fail = problem => {
        throw new MatchRecordError(`Match record ${matchID}: ${problem}`);
    };

    const { status, game_name: gameName, num_players: numPlayers, setup_data: setupData, credentials } = item;
    if (typeof status !== 'string') {
        fail('status is missing');
    }

    // Object.hasOwn, so names like "constructor" aren't found on the prototype.
    if (typeof gameName !== 'string' || !Object.hasOwn(games, gameName)) {
        fail(`unknown game_name ${JSON.stringify(gameName)}`);
    }
    const { game, idleTimeoutMs, maxLifetimeMs } = games[gameName];

    if (!Number.isInteger(numPlayers) || numPlayers < 1) {
        fail(`num_players must be a positive whole number, not ${JSON.stringify(numPlayers)}`);
    }
    if ((game.minPlayers !== undefined && numPlayers < game.minPlayers)
        || (game.maxPlayers !== undefined && numPlayers > game.maxPlayers)) {
        fail(`${gameName} can't be played by ${numPlayers} players`);
    }

    // One credential per seat, for seats "0" to "<num_players - 1>". The lobby
    // makes them all when the match is created, before anyone has joined.
    if (credentials === null || typeof credentials !== 'object' || Array.isArray(credentials)) {
        fail('credentials must be a map of seat number to credential');
    }
    const expectedSeats = Array.from({ length: numPlayers }, (_, i) => String(i));
    const seats = Object.keys(credentials).sort((a, b) => Number(a) - Number(b));
    if (seats.join() !== expectedSeats.join()) {
        fail(`credentials must have seats ${expectedSeats.join(', ')}; it has ${seats.join(', ') || 'none'}`);
    }
    for (const seat of seats) {
        if (typeof credentials[seat] !== 'string' || credentials[seat] === '') {
            fail(`the credential for seat ${seat} must be a non-empty string`);
        }
    }

    if (setupData !== undefined && (setupData === null || typeof setupData !== 'object')) {
        fail('setup_data must be a map if present');
    }

    return { matchID, status, gameName, game, idleTimeoutMs, maxLifetimeMs, numPlayers, setupData, credentials };
}

/** Reads and writes match records in DynamoDB. */
export class MatchTable {
    /**
     * tableName: e.g. mooseboardgames-matches-dev
     * endpoint: only for DynamoDB Local, e.g. http://localhost:8000
     */
    constructor({ tableName, region, endpoint }) {
        this.tableName = tableName;
        this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region, endpoint }), {
            // A game's ctx.gameover (stored as `result`) is whatever the game returns.
            marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
        });
    }

    /**
     * Update the record, but only if it exists and the match hasn't ended.
     * Returns false, without writing, otherwise.
     */
    async #updateUnlessOver(matchID, values) {
        const now = new Date().toISOString();
        const names = {};
        const exprValues = { ':now': now };
        const sets = ['updated_at = :now'];
        for (const [i, [attribute, value]] of Object.entries(values).entries()) {
            names[`#a${i}`] = attribute;
            exprValues[`:v${i}`] = value;
            sets.push(`#a${i} = :v${i}`);
        }
        names['#status'] = 'status';
        TERMINAL_STATUSES.forEach((status, i) => {
            exprValues[`:t${i}`] = status;
        });
        const terminal = TERMINAL_STATUSES.map((_, i) => `:t${i}`).join(', ');
        try {
            await this.client.send(new UpdateCommand({
                TableName: this.tableName,
                Key: { match_id: matchID },
                UpdateExpression: `SET ${sets.join(', ')}`,
                ConditionExpression: `attribute_exists(match_id) AND NOT (#status IN (${terminal}))`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: exprValues,
            }));
            return true;
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') {
                return false;
            }
            throw err;
        }
    }

    /** The raw record, or undefined if there is none. */
    async load(matchID) {
        const { Item } = await this.client.send(new GetCommand({
            TableName: this.tableName,
            Key: { match_id: matchID },
            // The lobby may have written it moments ago.
            ConsistentRead: true,
        }));
        return Item;
    }

    /**
     * Record that the server is up. Returns false, without writing, if the
     * record is gone or the match has already ended (for example, the lobby
     * cancelled it while the task was starting).
     *
     * expiresAt: a Date, the end of the match's maximum lifetime.
     */
    async markListening(matchID, { expiresAt }) {
        return this.#updateUnlessOver(matchID, {
            listening: true,
            listening_at: new Date().toISOString(),
            // When the reaper may stop the task, whatever the match's status.
            expires_at: expiresAt.toISOString(),
        });
    }

    /**
     * Set the match's status (IN_PROGRESS, or a terminal one), and `result`
     * if given. Returns false, without writing, if the record is gone or the
     * match has already ended: the first ending recorded wins.
     */
    async setStatus(matchID, status, { result } = {}) {
        const values = { status };
        if (result !== undefined) {
            values.result = result;
        }
        return this.#updateUnlessOver(matchID, values);
    }
}

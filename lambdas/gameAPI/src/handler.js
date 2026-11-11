// Entry point for the gameAPI Lambda, behind an API Gateway WebSocket API.
//
// Routes:
//   $connect     wss://...?match=<match_id>&token=<seat token>
//                Looks the token up in the match's seats to learn which player
//                this browser is, and records the connection.
//   $disconnect  Forgets the connection.
//   $default     A JSON message from the browser:
//                  {"type": "sync"}                           send me the current state
//                  {"type": "update", "args": [action, stateID]}  make a move
//
// The match and player always come from the connection row, never from the
// message, so a browser can only act as the seat its token gave it.
import { Master } from 'boardgame.io/dist/cjs/master.js';
import { getFilterPlayerView, ProcessGameConfig } from 'boardgame.io/dist/cjs/internal.js';

import { createDynamoDb, isConditionFailure } from './db.js';
import { GAMES } from './games.js';
import { MatchStorage } from './storage.js';
import { BufferedTransport, createPost } from './transport.js';

// API Gateway closes every WebSocket after 2 hours; keep rows a little longer,
// and let DynamoDB's TTL delete any that $disconnect missed.
const CONNECTION_LIFETIME_SECONDS = 3 * 60 * 60;

const _response = (statusCode, body = '') => ({ statusCode, body });

/** Where to send messages to browsers: the WebSocket API's management endpoint. */
function managementEndpoint(event) {
    const { domainName, stage } = event.requestContext;
    return process.env.WS_MANAGEMENT_ENDPOINT ?? `https://${domainName}/${stage}`;
}

/**
 * Build the Lambda handler. db, makePost and games are passed in so the tests
 * can use in-memory versions.
 *   db: see db.js
 *   makePost(endpoint): returns post(connectionID, data)
 *   games: {game_name: boardgame.io game object}
 */
export function createHandler({ db, makePost, games }) {
    const filterPlayerViews = {};
    const filterPlayerViewFor = (gameName) =>
        filterPlayerViews[gameName] ??= getFilterPlayerView(ProcessGameConfig(games[gameName]));

    async function connect(event) {
        const { match: matchID, token } = event.queryStringParameters ?? {};
        if (!matchID || !token) {
            return _response(400, 'match and token are required');
        }
        const match = await db.getMatch(matchID);
        const playerID = match?.seats?.[token];
        if (playerID === undefined || !(match.game_name in games)) {
            return _response(403, 'not a player in that match');
        }
        await db.putConnection({
            connection_id: event.requestContext.connectionId,
            match_id: matchID,
            player_id: playerID,
            game_name: match.game_name,
            num_players: Object.keys(match.seats).length,
            expire_at: Math.floor(Date.now() / 1000) + CONNECTION_LIFETIME_SECONDS,
        });
        return _response(200);
    }

    async function disconnect(event) {
        await db.deleteConnection(event.requestContext.connectionId);
        return _response(200);
    }

    /**
     * Run fn(master, storage) with a fresh boardgame.io Master for this
     * connection, then send whatever it produced. If fn throws, nothing is sent.
     */
    async function withMaster(event, connection, fn) {
        const game = games[connection.game_name];
        const storage = new MatchStorage(db);
        const transport = new BufferedTransport({
            connection,
            filterPlayerView: filterPlayerViewFor(connection.game_name),
            db,
            post: makePost(managementEndpoint(event)),
        });
        const master = new Master(game, storage, transport);
        await fn(master, storage);
        await transport.flush();
    }

    function sync(event, connection) {
        return withMaster(event, connection, master =>
            master.onSync(connection.match_id, connection.player_id, undefined, connection.num_players));
    }

    async function message(event) {
        const connection = await db.getConnection(event.requestContext.connectionId);
        if (connection === undefined) {
            return _response(403, 'unknown connection');
        }
        let body;
        try {
            body = JSON.parse(event.body);
        } catch {
            return _response(400, 'message is not JSON');
        }

        if (body.type === 'sync') {
            try {
                await sync(event, connection);
            } catch (err) {
                if (!isConditionFailure(err)) {
                    throw err;
                }
                // Another player's sync created the match at the same moment;
                // theirs was saved, so sync again to get it.
                await sync(event, connection);
            }
            return _response(200);
        }

        if (body.type === 'update') {
            const [action, stateID] = body.args ?? [];
            if (!action?.payload) {
                return _response(400, 'update needs an action');
            }
            // boardgame.io applies the move as action.payload.playerID, so make
            // sure that is the player this connection belongs to.
            action.payload.playerID = connection.player_id;
            try {
                await withMaster(event, connection, (master, storage) => {
                    storage.expectedStateID = stateID;
                    return master.onUpdate(action, stateID, connection.match_id, connection.player_id);
                });
            } catch (err) {
                if (!isConditionFailure(err)) {
                    throw err;
                }
                // Another move was saved first, so this one was dropped. Send
                // this player the current state so they can try again.
                await sync(event, connection);
            }
            return _response(200);
        }

        return _response(400, `unknown message type ${body.type}`);
    }

    return async function handler(event) {
        const { routeKey } = event.requestContext;
        try {
            if (routeKey === '$connect') {
                return await connect(event);
            }
            if (routeKey === '$disconnect') {
                return await disconnect(event);
            }
            return await message(event);
        } catch (err) {
            // Log the stack trace as ONE CloudWatch entry; it starts a new
            // entry at each "\n".
            console.error(String(err?.stack ?? err).replace(/\n/g, '\r'));
            return _response(500);
        }
    };
}

export const handler = createHandler({ db: createDynamoDb(), makePost: createPost, games: GAMES });

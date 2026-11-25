# Match record

One item per match in the matches table (`mooseboardgames-matches-<env>`, partition key `match_id`). It's how the pieces of the Fargate game host coordinate: none of them call each other, they read and write this record. See [fargate-host-design.md](fargate-host-design.md) for the overall design.

The lobby creates the record when a player creates an open game, so the game server starts while the waiting room fills. The lobby makes every seat's credential at that point, before anyone has joined. Once every seat is taken and the match is `READY`, it gives each player only their own, through `GET /open-games/{id}/match` (seats go to players in sorted order of user ID).

## Attributes

| Attribute | Type | Written by | Read by | Meaning |
|-----------|------|------------|---------|---------|
| `match_id` | string | lobby | everything | The match ID: the same as the open game's `open_game_id`. Also the boardgame.io match ID and the URL path: `/m/<match_id>/...` |
| `status` | string | see [Statuses](#statuses) | router, lobby, container, reaper | Where the match is in its life |
| `game_name` | string | lobby | container | Which game, by the boardgame.io game's `name`, e.g. `ur`. Must be in [game-server/src/games.js](../game-server/src/games.js) |
| `num_players` | number | lobby | container | Number of seats |
| `setup_data` | map, optional | lobby | container | Passed to the game's `setup` as boardgame.io `setupData` (game options) |
| `credentials` | map of string | lobby | container | One boardgame.io credential per seat: `{"0": "...", "1": "..."}`, seats `0` to `num_players - 1`. Random, and useless once the match ends |
| `task_arn` | string | lobby | lobby (cancel) | The Fargate task hosting the match |
| `launch_error` | string | lobby | people debugging | Why the task couldn't be started, when the lobby sets `ABORTED` |
| `listening` | boolean | container, with `READY` | people debugging | The server has started and loaded the match |
| `expires_at` | ISO 8601 string | container, with `listening` | reaper | End of the game's maximum lifetime (per game, in [games.js](../game-server/src/games.js)), counted from when the task started. The container ends the match itself then; the reaper stops the task if it's still running after this |
| `origin_host` | string | container, with `READY`; cleared by the reaper | router | The task's public DNS name, where CloudFront sends connections. Not set when running locally. The reaper clears it if the task crashed |
| `result` | map, optional | container | (later: history, stats) | boardgame.io's `ctx.gameover` when the game ends |
| `created_at`, `updated_at`, `listening_at` | ISO 8601 string | whoever writes | people debugging | Timestamps |

## Statuses

| Status | Set by | Meaning |
|--------|--------|---------|
| `CREATED` | lobby | Record written; no task yet. The lobby then starts the task in the same request (locally, where launching isn't configured, it stays `CREATED` until you start a server by hand) |
| `LAUNCHING` | lobby, only if still `CREATED` | `RunTask` succeeded; the task is starting |
| `READY` | container, with `listening`, `expires_at` and `origin_host` | Players can connect. The router routes only `READY` and `IN_PROGRESS` |
| `IN_PROGRESS` | container | Every seat has connected |
| `ENDED` | container | The game finished; `result` is set |
| `ABANDONED` | container | No moves for the game's idle timeout, or the game's maximum lifetime was reached |
| `CANCELLED` | container (waiting room timed out) or lobby (owner cancelled) | The seats never filled |
| `ABORTED` | reaper, lobby, or container | The task stopped without the container recording an ending (a crash, found by the reaper); the task couldn't be started (`launch_error` says why); the container couldn't start serving; or the task was stopped mid-game |

`ENDED`, `ABANDONED`, `CANCELLED` and `ABORTED` are terminal: nothing changes the status after one of them. A container that finds its match already terminal when it starts exits without serving it.

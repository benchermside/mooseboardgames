// Container entrypoint: host the one match named by MATCH_ID, until it's over.
//
// Environment:
//   MATCH_ID                        required; the launch Lambda sets it per task
//   MATCHES_TABLE                   required; set in the task definition
//   PORT                            default 8000
//   AWS_REGION                      set by Fargate; defaults to us-east-1
//   DYNAMODB_ENDPOINT_URL           only for running against DynamoDB Local
//   WAITING_ROOM_TIMEOUT_SECONDS    default 900: every seat must connect by then
//   IDLE_TIMEOUT_SECONDS            longest gap between moves. Normally unset:
//                                   each game has its own (games.js). Setting
//                                   it overrides that, e.g. for testing.
//   MAX_LIFETIME_SECONDS            the longest the match may run. Likewise
//                                   normally unset: each game has its own.
//   GAME_OVER_GRACE_SECONDS         default 30: how long to stay up after game over
import { GAMES } from './games.js';
import { hostMatch } from './host.js';
import { DEFAULT_TIMEOUTS } from './lifecycle.js';
import { log } from './log.js';
import { MatchTable } from './match-record.js';

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`${name} is not set`);
        process.exit(1);
    }
    return value;
}

/** Milliseconds from an environment variable in seconds, or the default (which may be undefined). */
function secondsEnv(name, defaultMs = undefined) {
    const value = process.env[name];
    if (value === undefined || value === '') {
        return defaultMs;
    }
    const seconds = Number(value);
    if (!(seconds > 0)) {
        console.error(`${name} must be a positive number of seconds, not ${JSON.stringify(value)}`);
        process.exit(1);
    }
    return seconds * 1000;
}

log('STARTING');
const matchID = requireEnv('MATCH_ID');
const table = new MatchTable({
    tableName: requireEnv('MATCHES_TABLE'),
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.DYNAMODB_ENDPOINT_URL || undefined,
});
const timeouts = {
    waitingRoomMs: secondsEnv('WAITING_ROOM_TIMEOUT_SECONDS', DEFAULT_TIMEOUTS.waitingRoomMs),
    gameOverGraceMs: secondsEnv('GAME_OVER_GRACE_SECONDS', DEFAULT_TIMEOUTS.gameOverGraceMs),
};
// Per-game settings, which these override only when set.
const perGameOverrides = { idleMs: 'IDLE_TIMEOUT_SECONDS', maxLifetimeMs: 'MAX_LIFETIME_SECONDS' };
for (const [key, name] of Object.entries(perGameOverrides)) {
    const overrideMs = secondsEnv(name);
    if (overrideMs !== undefined) {
        timeouts[key] = overrideMs;
    }
}

// StopTask sends SIGTERM; Ctrl+C sends SIGINT when running by hand. Until the
// lifecycle exists nobody can have connected, so just exit.
let lifecycle;
const onStopSignal = () => {
    if (lifecycle === undefined) {
        log('STOP SIGNAL while starting; exiting');
        process.exit(0);
    }
    lifecycle.onStopSignal();
};
process.on('SIGTERM', onStopSignal);
process.on('SIGINT', onStopSignal);

let hosted;
try {
    hosted = await hostMatch({ matchID, table, games: GAMES, port: Number(process.env.PORT ?? 8000), timeouts, exit: code => process.exit(code) });
} catch (err) {
    // Exiting stops the task; the task-state Lambda will mark the match ABORTED.
    log(`FAILED ${err.message}`);
    process.exit(1);
}

if (hosted.outcome === 'already-over') {
    log(`NOT HOSTING: match is already ${hosted.status}`);
    process.exit(0);
}
lifecycle = hosted.lifecycle;
log(`LISTENING port=${hosted.port} matchID=${matchID}`);

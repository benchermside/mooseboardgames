# Phase 0 spikes for the Fargate game host

This is throwaway code that tests the riskiest assumptions in [../documentation/fargate-host-design.md](../documentation/fargate-host-design.md) before Phase 1 builds anything for real. Record what you find in [RESULTS.md](RESULTS.md), and then update the design doc.

| Spike | Question | Where it runs | How |
|-------|----------|---------------|-----|
| S1 | Does a WebSocket work end to end through CloudFront → Lambda@Edge → Fargate on HTTP port 8000? Does an idle connection survive? | AWS | `aws/launch-and-measure.js --keep`, then `client/ws-client.js` |
| S2 | Does a Fargate task's network interface get a public DNS name (D6), and how soon after RUNNING? | AWS | `aws/launch-and-measure.js` |
| S3 | Can boardgame.io take a match seeded with our own match ID and credentials, serve Socket.IO on a per-match path, and have its storage wrapped? | Your PC | `s3/run-s3.js` |
| S4 | How long from `RunTask` until the match answers through CloudFront? | AWS | `aws/launch-and-measure.js --runs 5` |

## Prerequisites

- Node.js 22.
- Docker Desktop, running.
- The AWS CLI, signed in to your account with region us-east-1. `aws sts get-caller-identity` should work.

## Order

1. **S3, locally.** It needs no AWS.
   ```powershell
   cd spikes
   npm install
   node s3/run-s3.js
   ```
   Every line should say PASS. It checks both routing-key modes: `path`, which is the plan, and `query`, which is the fallback.
2. **AWS setup:** follow [AWS-SETUP.md](AWS-SETUP.md), Steps 0–8.
3. **S2 + S4, then S1:** follow "Running the spikes" in AWS-SETUP.md.
4. **Clean up:** follow [AWS-CLEANUP.md](AWS-CLEANUP.md).
5. **Write up:** fill in [RESULTS.md](RESULTS.md) and update the design doc.

## What's here

| Path | What it is |
|------|------------|
| `server/server.js` | `startServer()`: a boardgame.io server that hosts exactly one match. It serves Socket.IO at `/m/<matchID>/socket.io` (or, in `query` mode, at `/socket.io?matchID=...`), answers `GET /m/<matchID>/healthz`, and returns 404 for boardgame.io's Lobby API. |
| `server/main.js` | The container entrypoint. Configured by `MATCH_ID`, `PORT`, `SEAT_CREDENTIALS`, and `SOCKET_PATH_MODE`. It logs `STARTING`, `LISTENING`, and `SIGTERM` with timestamps. |
| `server/seed.js` | Puts a match into storage under a chosen match ID and per-seat credentials. |
| `server/activity-storage.js` | Wraps boardgame.io's in-memory store to track activity and notice game over. This is a prototype of T7. |
| `server/Dockerfile` | The ARM64 image. It hosts the real Ur game from `games/ur`. Build it from the repo root. |
| `s3/run-s3.js`, `s3/test-game.js` | The S3 checks, plus a game that ends after three moves. |
| `client/ws-client.js` | The S1 client: connect through CloudFront, make a move, sit idle, then check the connection still works. |
| `client/bgio-client.js` | Helpers for running a boardgame.io client from Node. |
| `aws/launch-and-measure.js` | S2/S4: run a task and time every step until it is reachable through CloudFront. |
| `aws/router/index.mjs` | The Lambda@Edge origin-request router. It looks up the match in DynamoDB. |
| `aws/*.json` | IAM policies to paste into the console, and the config template. |

## Running the server by itself

```powershell
cd spikes
$env:MATCH_ID="test"; $env:PORT="8001"; node server/main.js
# in another window:
curl.exe http://localhost:8001/m/test/healthz
node client/ws-client.js --url http://localhost:8001 --match test --idle-minutes 1
```

Or test the image itself:
```powershell
docker buildx build --platform linux/arm64 -f spikes/server/Dockerfile -t mbg-spike-game-server:local --load .
docker run --rm --platform linux/arm64 -p 8001:8000 -e MATCH_ID=test mbg-spike-game-server:local
```
Your PC emulates ARM64, so the container takes about 10 seconds to start locally. That's not a sign of how fast it starts on Fargate.

## Ways the spikes differ from the design

- The container gets seat credentials from the `SEAT_CREDENTIALS` environment variable. The real container will read them from the match record in DynamoDB.
- `launch-and-measure.js` writes the origin host itself. The real system will use the EventBridge task-state Lambda (T11) for that.
- The spike uses its own CloudFront distribution and DynamoDB table, not the site's.

# Phase 0 spike results

Fill this in as you run each spike. When it's done, carry anything that changes a decision into [../documentation/fargate-host-design.md](../documentation/fargate-host-design.md).

Date run: ____________

## S3: boardgame.io server internals (local)

Status: **PASS** in both modes, on 2026-11-11.

| Check | `path` mode | `query` mode |
|-------|-------------|--------------|
| A match seeded with a chosen ID and credentials syncs | PASS | PASS |
| A move with the right credentials is applied | PASS | PASS |
| A client with wrong credentials is refused at sync | PASS | PASS |
| A forged move with wrong credentials is not applied | PASS | PASS |
| A connection for a different match ID is refused | PASS | PASS |
| The storage wrapper counts writes and updates last activity | PASS | PASS |
| The storage wrapper sees `ctx.gameover` | PASS | PASS |
| Health check returns 200; the Lobby API returns 404 | PASS | PASS |

Findings:
- **A custom Socket.IO path works without any patching.** boardgame.io passes the server's `socketOpts` straight to Socket.IO, so `new SocketIO({ socketOpts: { path: '/m/<id>/socket.io' } })` is enough. The client sets the same `path` in its `socketOpts`. The query-string fallback isn't needed.
- **Seeding** uses `createMatch` from `boardgame.io/dist/cjs/internal.js`. Setting `metadata.players[i].credentials` turns on boardgame.io's normal credential check.
- **`InMemory` isn't exported.** The spike borrows the instance that `Server()` makes by default. T7 could do the same, or include a small Map-based store.
- **The Lobby API should be hidden.** boardgame.io serves its Lobby API (create/join match) on the same port by default. The spike blocks it with a Koa middleware, and T6 needs the same thing.
- **Ping timing.** boardgame.io sets Socket.IO to ping every 10 s, with a 20 s timeout.

## S2: public DNS name on Fargate task ENIs

Status: ______

| Run | RUNNING (s) | Public DNS known (s) | DNS minus RUNNING (s) | Example name |
|-----|-------------|----------------------|------------------------|--------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

- Was the DNS name present on every run? ______
- Does D6 hold? ______

## S4: cold start (RunTask → ready through CloudFront)

| Image | Size in ECR | RUNNING median (s) | ready median (s) | ready max (s) | STARTING→LISTENING in container (s) |
|-------|-------------|--------------------|------------------|---------------|-------------------------------------|
| node:22-alpine | | | | | |
| node:22-slim (optional) | | | | | |

- Is it fast enough for players waiting in the lobby? ______
- Is SOCI or a slimmer image worth doing? ______

## S1: WebSocket through CloudFront + Lambda@Edge → Fargate

Status: ______

| Check | Result |
|-------|--------|
| Connected over websocket through CloudFront (transport: websocket) | |
| Move applied (roll) | |
| Chat round trip before idle (ms) | |
| Idle minutes survived, with pings and no disconnects | |
| Chat round trip after idle (ms) | |
| Direct `curl` to the task's origin host on port 8000 times out | |
| Router logs: one line per connection, not one per message | |
| Router log region(s) seen | |

Notes: ______

## Design doc changes needed

- ______

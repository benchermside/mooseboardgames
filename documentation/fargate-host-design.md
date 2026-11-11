# Fargate Game Host — Design

## Purpose

Run each boardgame.io match in its own short-lived AWS Fargate task, launched by the existing lobby when a match starts collecting players and stopped when the match ends or is abandoned. The overriding constraint is **cost that scales to zero with usage**: no always-on load balancers, NAT gateways, or other fixed-price infrastructure. Every recurring cost must be per-request, per-second, or negligible (a few cents per month).

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | TLS termination for player WebSockets | CloudFront |
| D2 | How CloudFront finds the task for a match | Lambda@Edge (origin-request trigger) looking up the match in DynamoDB |
| D3 | CloudFront → task connection | Plain HTTP. No secret header. Tasks must not be reachable from the public internet; the security group admits only CloudFront. |
| D4 | Match durability | In memory only. If a container crashes, its match is lost (recorded as `ABORTED`); only final results are persisted. |
| D5 | Hosting unit | One Fargate task per match, launched with `RunTask` (not an ECS Service) |

## Proposed defaults (override in review)

These are choices that seemed to have a clear best answer; each is easy to change.

- **Routing key in the URL is a path prefix.** Players connect to `wss://<play-host>/m/<matchID>/socket.io/...`. The container configures its Socket.IO server path to `/m/<matchID>/socket.io` from its environment, so a stray connection for another match is rejected by the container itself. Fallback if boardgame.io's transport won't accept a custom path: put `matchID` in the Socket.IO query string and forward query strings to the origin.
- **The client uses WebSocket transport only** (`transports: ['websocket']`), skipping Socket.IO's HTTP long-polling. Long-polling would send every poll through CloudFront and invoke Lambda@Edge each time, adding cost and latency.
- **The container listens on port 8000** (not 80, so it can run as non-root). CloudFront allows custom-origin HTTP ports in the 1024–65535 range.
- **Tasks run on ARM64 (Graviton) at 0.25 vCPU / 0.5 GB** to start; resize after load testing. Fargate Spot is not used, because an interruption would kill the match.
- **Timeouts (all configurable):**
  - Waiting room: if not all seats join within 10 minutes, the match is `CANCELLED`.
  - Idle: if no move is made for 15 minutes, the match is `ABANDONED`.
  - Hard maximum task lifetime: 4 hours.
  - Shutdown grace period after game over: 30 seconds.

## Open questions

These are not yet decided; each has a recommendation.

- **Q1. Origin hostname for the task.** CloudFront origins must be domain names, not IPs. Either use the public DNS name AWS assigns to the task's network interface (`ec2-a-b-c-d.<region>.compute.amazonaws.com`, requires VPC DNS hostnames enabled), or create a Route 53 record per task. **Recommendation:** the AWS-assigned name. It avoids per-task record management and Route 53 propagation delays. Confirm it's reliably present for Fargate ENIs (spike S2), with Route 53 as the fallback.
- **Q2. Which CloudFront distribution.** Either add a `/m/*` cache behavior to the distribution that already serves the site, or use a dedicated distribution on a subdomain (e.g., `play.<domain>`). **Recommendation:** a behavior on the existing distribution if the site is already on CloudFront. That means same origin for the browser, no CORS, and one certificate. Otherwise use a dedicated subdomain.
- **Q3. Container image packaging.** Either one image containing every game, with the game selected by environment variable, or one image per game. **Recommendation:** one image while the catalog is small. It's simpler to build, and the task definition is shared. Revisit if image size starts hurting cold starts.

## Architecture

### Components

- **Lobby backend (existing, Lambda + DynamoDB).** Creates the match record and issues per-seat player credentials. Additions: it launches the task and exposes match status to clients.
- **Match table (DynamoDB).** Either the lobby's existing table or a new one, with these new attributes:
  - status
  - task ARN
  - origin host
  - listening flag
  - timestamps
  - final result
- **Game server container (Fargate).** A boardgame.io server hosting exactly one match.
- **Orchestration Lambdas.** Launch, task-state handler, cancel, and reaper.
- **CloudFront distribution plus Lambda@Edge router.** Terminates TLS and routes each connection to the right task.

### Match lifecycle (state machine)

```
CREATED ──launch──▶ LAUNCHING ──(origin known AND listening)──▶ READY ──first move──▶ IN_PROGRESS
   │                    │                                         │                       │
   │                    └──task fails to start──▶ ABORTED          │                       ├──gameover──▶ ENDED
   │                                                              │                       ├──idle timeout──▶ ABANDONED
   └──lobby cancels / waiting-room timeout ─────────────────────▶ CANCELLED              └──task dies unexpectedly──▶ ABORTED
```

The lobby never shows a connect URL to players until the match is `READY`.

### Launch sequence

1. A player opens a match in the lobby. The lobby writes a `CREATED` record containing the game name, seat count, setup data, and per-seat credentials.
2. The launch Lambda calls `RunTask`. It passes only `MATCH_ID` (plus `GAME_NAME` if Q3 goes per-image) as container environment overrides, and tags the task with the match ID. It records the task ARN and sets status to `LAUNCHING`.
3. The container boots and reads the match record from DynamoDB. It seeds the match into boardgame.io's in-memory storage under the lobby-assigned match ID, starts the server, and sets `listening = true` on the match record.
4. Independently, an EventBridge rule on ECS Task State Change (`RUNNING`) invokes the task-state Lambda. That Lambda looks up the task's ENI, gets its public DNS name (Q1), and writes it to the match record as the origin host.
   - This has to happen outside the container: the ECS task metadata endpoint exposes only the private IP.
   - It can't be replaced by a Lambda health-check either, because the security group admits only CloudFront.
5. When both `listening` and the origin host are set, the lobby marks the match `READY` and pushes the connect URL to the waiting players. Whichever write lands second triggers this, via a conditional update or a DynamoDB Stream.

### Connection path

```
Browser ──wss──▶ CloudFront (/m/*) ──[Lambda@Edge origin-request]──http:8000──▶ Fargate task
```

**CloudFront behavior for `/m/*`:**
- Cache policy `CachingDisabled`.
- An origin request policy forwarding the WebSocket handshake headers (`Sec-WebSocket-Key`, `-Version`, `-Protocol`, `-Extensions`) plus whatever the routing key needs.
- A placeholder custom origin, which Lambda@Edge overwrites per request.

**Lambda@Edge router (origin-request):**
- Parses `matchID` from the URI and reads the match record from DynamoDB, using an explicit region since edge functions run in many regions.
- If the match is `READY` or `IN_PROGRESS`, it sets `request.origin.custom` to the task's host, port 8000, protocol `http`.
- Otherwise it returns a generated 404 or 503 response.
- Lambda@Edge has no environment variables, so the table name and region are bundled into the code at build time.
- It caches positive lookups in module scope (the match-to-origin mapping never changes once set) and never caches misses.
- Only the WebSocket handshake goes through the router; frames on an established connection don't invoke it.

**Security group for tasks:**
- Inbound: TCP 8000 only, from the AWS-managed prefix list `com.amazonaws.global.cloudfront.origin-facing`.
- Outbound: open, needed for pulling images from ECR, DynamoDB, and CloudWatch Logs.
- Tasks run in public subnets with `assignPublicIp: ENABLED`. This is required for CloudFront to reach them and avoids a NAT gateway. The inbound rule is what keeps them off the open internet.
- Accepted residual risk (per D3): the prefix list covers all of CloudFront, so another CloudFront distribution could in principle reach a task if it knew its hostname. Player credentials are still required to join a seat.

### Authentication

The lobby generates the per-seat credentials and stores them on the match record. The container loads them at boot and puts them in the boardgame.io match metadata, so boardgame.io's standard credential check applies. Hidden information works unchanged, because `playerView` filtering runs server-side in the container.

### Shutdown

**In-container watchdog.** The container's storage adapter is a thin wrapper around boardgame.io's in-memory store. Every state write updates a last-activity timestamp and checks `ctx.gameover`.

- **Game over:** write the result and status `ENDED`, wait out the grace period, then exit 0.
- **Idle timeout:** write status `ABANDONED`, then exit.
- **Waiting room timeout:** status `CANCELLED`, then exit.

Because the game server is the task's only essential container, its exit stops the task.

**SIGTERM handler.** `StopTask` (used by lobby cancel and the reaper) sends SIGTERM. The handler records a terminal status if none is set yet, then exits.

**Task-state Lambda on `STOPPED`.**
- If the match record has no terminal status, mark it `ABORTED` (this is the crash path, per D4).
- Clear the origin host so the router stops routing to the old task.

**Reaper (EventBridge schedule, every 15 minutes).** Stops any task tagged with a match ID that is past its hard maximum lifetime, or whose match record is already terminal. This catches hung processes and anything the other paths miss.

### Client

- The boardgame.io client uses the SocketIO transport with `server` set to the play host. Its `socketOpts` set the per-match path and websocket-only transport.
- On disconnect, the client asks the lobby for the match status. If the status is terminal (`ENDED`, `ABANDONED`, `ABORTED`), it shows that outcome instead of retrying.

### Cost profile

| Item | Cost basis |
|------|-----------|
| Fargate vCPU and memory | Per second, 1-minute minimum per task |
| Public IPv4 address | Hourly, only while a task runs |
| CloudFront requests and data transfer | Per request and per GB |
| Lambda@Edge | Per invocation (one per connection) |
| DynamoDB | On-demand, per request |
| ECR | Per GB of image storage |
| CloudWatch Logs | Per GB ingested, with a retention limit set |

There is no ALB, no NAT gateway, and no provisioned capacity, so idle cost is a few cents per month.

## Tasks

### Phase 0 — Spikes (de-risk before building)

- **S1.** End-to-end hello world: a browser WebSocket connects through CloudFront and a Lambda@Edge origin-request rewrite to a Fargate task on HTTP port 8000. Confirm the upgrade works and idle connections survive with Socket.IO pings.
- **S2.** Confirm that Fargate task ENIs in a public subnet expose a public DNS name (Q1), and measure how quickly it's available after `RUNNING`.
- **S3.** boardgame.io server internals:
  - Seed a match with an externally chosen match ID and credentials into in-memory storage.
  - Set a custom Socket.IO server path.
  - Wrap the storage adapter for activity tracking.
  - Fall back to the query-string routing key if a custom path isn't possible.
- **S4.** Measure cold start, from `RunTask` to `READY`, with a realistic image. If it's too slow, try a slimmer base image or SOCI lazy loading.

### Phase 1 — Infrastructure (IaC)

- **T1.** VPC public subnets for game tasks, with DNS hostnames enabled. Create the task security group with the CloudFront prefix-list inbound rule.
- **T2.** Set up the container platform:
  - ECR repository.
  - ECS cluster.
  - ARM64 task definition, with the game server as the single essential container and `stopTimeout` set.
  - Execution role.
  - Task role scoped to the match table.
  - Log group with retention.
- **T3.** Extend the match table schema with status, task ARN, origin host, listening flag, timestamps, and result. Enable a stream if it's used for the `READY` transition.
- **T4.** CloudFront `/m/*` behavior or distribution (per Q2): cache and origin request policies, placeholder origin, and a certificate for the play host.
- **T5.** Lambda@Edge router: build-time configuration, IAM role with read access to the match table, versioned deployment in us-east-1, association with the behavior.

### Phase 2 — Game server container

- **T6.** Entrypoint. Read `MATCH_ID`, load the match record, seed the boardgame.io match with its credentials, start the server on the per-match path, and set `listening`.
- **T7.** Activity-tracking storage wrapper and watchdog: game over, idle, and waiting-room timeouts, each writing its terminal status before exit.
- **T8.** SIGTERM handler and the graceful shutdown sequence.
- **T9.** Container image build: one image for all games (per Q3), non-root user, small base image.

### Phase 3 — Orchestration

- **T10.** Launch Lambda, triggered by the lobby: `RunTask` with overrides and tags, then record the task ARN and set `LAUNCHING`.
- **T11.** Task-state Lambda with an EventBridge rule:
  - On `RUNNING`: resolve the ENI's public DNS name and write the origin host.
  - On `STOPPED`: set `ABORTED` if no terminal status exists, and clear the origin host.
- **T12.** `READY` transition and lobby notification to waiting players.
- **T13.** Lobby cancel path: `StopTask` and set `CANCELLED`.
- **T14.** Reaper Lambda on an EventBridge schedule.

### Phase 4 — Client

- **T15.** Configure the client's SocketIO transport (server, path, websocket-only) from the connect URL the lobby provides.
- **T16.** Disconnect handling and UI for the terminal statuses.

### Phase 5 — Operations and verification

- **T17.** Alarms for:
  - Tasks failing to start.
  - Matches stuck in `LAUNCHING`.
  - Running task count above a threshold.
  - Lambda@Edge errors. These are logged in the region of the edge location that served the request, so aggregate them.
- **T18.** AWS Budgets alert on monthly spend.
- **T19.** Load test with many concurrent matches. Check the regional Fargate vCPU quota and `RunTask` rate limits, and request increases if needed.
- **T20.** Failure drills. Kill a task mid-game and verify `ABORTED` handling end to end. Let a match idle out. Abandon a waiting room.

# Phase 0 spike results

Fill this in as you run each spike. When it's done, carry anything that changes a decision into [../documentation/fargate-host-design.md](../documentation/fargate-host-design.md).

Date run: S3 on 2026-11-11; S2 and S4 on 2026-11-17; S1 on 2026-11-20, on the real dev distribution.

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

Status: **PASS**, on 2026-11-17.

| Run | RUNNING (s) | Public DNS known (s) | DNS minus RUNNING (s) | Example name |
|-----|-------------|----------------------|------------------------|--------------|
| 1 | 15.95 | 6.70 | -9.25 | `ec2-18-208-168-183.compute-1.amazonaws.com` |
| 2 | 21.00 | 7.46 | -13.54 | `ec2-54-160-188-222.compute-1.amazonaws.com` |
| 3 | 17.47 | 6.88 | -10.59 | `ec2-3-92-50-238.compute-1.amazonaws.com` |
| 4 | 16.61 | 6.81 | -9.80 | `ec2-54-198-100-127.compute-1.amazonaws.com` |
| 5 | 17.70 | 6.38 | -11.32 | `ec2-100-55-2-6.compute-1.amazonaws.com` |

- Was the DNS name present on every run? Yes. It was known 6–7.5 s after `RunTask`, 9–14 s before RUNNING.
- Does D6 hold? Yes. The task-state Lambda (T11) can rely on the name being there when it sees RUNNING.

## S4: cold start (RunTask → ready through CloudFront)

| Image | Size in ECR | RUNNING median (s) | ready median (s) | ready max (s) | STARTING→LISTENING in container (s) |
|-------|-------------|--------------------|------------------|---------------|-------------------------------------|
| node:22-alpine | 68 MB | 17.47 | 18.43 | 32.54 | ~0.2 |
| node:22-slim (optional) | not tried | | | | |

Per-run ready times (s): 17.91, 32.54, 18.43, 17.64, 28.11.

- Is it fast enough for players waiting in the lobby? Yes. The median is about 18 s, at the fast end of the 15–30 s estimate.
- Is SOCI or a slimmer image worth doing? Not now. The image pull took about 3 s, and Node starts listening about 0.2 s after it starts, so most of the time is Fargate provisioning, which neither would change.
- **Outliers:** in runs 2 and 5, ready came about 10 s after the origin was written; in the other three it came within 1.5 s. The script polls every 500 ms, so the gap is not the script. 10 s matches CloudFront's default origin connection timeout. The likely cause: CloudFront's first connection attempt went out before the task's network accepted traffic, was silently dropped, and CloudFront waited out the timeout before retrying. Not confirmed. To try in Phase 1: set the `/m/*` origin's connection timeout to 2–3 s, which would cut the worst case to about 22 s.

## S1: WebSocket through CloudFront + Lambda@Edge → Fargate

Status: **PASS**, on 2026-11-20, against the real dev distribution (`dev.mooseboardgames.com`, design T5a), match `spike-mwlbia37`.

Originally deferred: the first attempts failed with `502 LambdaValidationError` because the distribution's origin was left at **HTTPS only**, and CloudFront doesn't let Lambda@Edge downgrade a request to HTTP. Once that was fixed, S2 and S4 passed, but the spike distribution was deleted before S1 ran. CloudFront supports WebSockets, and boardgame.io pings every 10 s, so the risk was judged low. S1 will run as the first end-to-end test on the real dev distribution once Phase 1's `/m/*` behavior is in place. If it fails, revisit D1/D2 (for example, an ALB or API Gateway WebSockets).

Already confirmed without S1: requests reach the task through CloudFront and the router (the S4 health checks); connecting to the task directly is blocked by the security group; router logs for the Philadelphia edge location land in us-east-1.

| Check | Result |
|-------|--------|
| Connected over websocket through CloudFront (transport: websocket) | PASS |
| Move applied (roll) | PASS |
| Chat round trip before idle (ms) | 41 (in the earlier quick run) |
| Idle minutes survived, with pings and no disconnects | 20 (1201.7 s, 119 pings, 0 disconnects) |
| Chat round trip after idle (ms) | 31 |
| Direct `curl` to the task's origin host on port 8000 times out | not rechecked (confirmed during S4) |
| Router logs: one line per connection, not one per message | not checked |
| Router log region(s) seen | not checked (us-east-1 during S4) |

End of the 20-minute run:

```
2026-11-20T22:02:46.915Z [+1201.67s] still idle: connected=true pings=119 disconnects=0
2026-11-20T22:02:46.946Z [+1201.70s] chat round trip OK in 31 ms
2026-11-20T22:02:46.947Z [+1201.70s] S1 RESULT: PASS
```

Notes:
- **The site's WAF blocks clients without a User-Agent.** The first dev runs failed with `connect_error: websocket error` 0.1 s in: the AWS managed common rule set's `NoUserAgent_HEADER` rule returned 403, because Node's WebSocket sends no User-Agent. Browsers always send one, so real players aren't affected. Any Node client (tests, bots) must set one; `client/bgio-client.js` now does, via `extraHeaders`.
- D1/D2 hold: no need for an ALB or API Gateway WebSockets.

## Design doc changes needed

- T4: the `/m/*` origin must be **HTTP only, port 8000**. HTTPS only makes every routed request fail with `502 LambdaValidationError`. Try a 2–3 s origin connection timeout (see S4).
- T5a: S1's checks passed on the dev distribution on 2026-11-20 (WebSocket upgrade, 20-minute idle survival). The one-router-call-per-connection check wasn't done.
- Node clients must send a User-Agent, or the WAF blocks them (see S1 notes).
- Debugging note: CloudFront writes Lambda@Edge validation errors to `/aws/cloudfront/LambdaEdge/<distribution ID>`, not to the function's own log group.

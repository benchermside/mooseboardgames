# Running the site locally

Everything here is for running the site on your own machine. None of it is
deployed. It works the same on macOS and Windows.

## Prerequisites

- **Docker Desktop.** On Windows, use the WSL2 backend (the default).
- **just.** macOS: `brew install just`. Windows: `winget install Casey.Just`.

That's all you need to run the site. To run the tests or build a deployment,
you also need [uv](https://docs.astral.sh/uv/).

## Usage

From the repo root:

| Command         | What it does |
|-----------------|--------------|
| `just dev`      | Starts everything in one terminal; stop with Ctrl+C. Edits to `lambdas/siteAPI/src/` restart the Lambda automatically. Edits to `html/` show up on browser refresh. |
| `just down`     | Removes the containers. Local data is kept. |
| `just db-reset` | Puts the local tables back to just the sample data. |

Once it's running:

- **http://localhost:8080** serves the site from `html/`. This stands in for S3.
- **http://localhost:3000** is the API. This stands in for API Gateway plus the siteAPI Lambda.
- **http://localhost:8000** is DynamoDB Local. To browse it, use
  `aws dynamodb scan --table-name mooseboardgames-open_games-dev --endpoint-url http://localhost:8000`
  (any credentials work).

Use `localhost`, not `127.0.0.1`, in the browser, so that cookies reach the API.

## Sample data

The first time the tables are created (and after `just db-reset`), they get:

- user `u_123456789`, the user the routes currently hard-code.
- a non-expiring login cookie `c_localdev` for that user. Set it in the browser
  console with `document.cookie = "cookie_id=c_localdev"`.
- one open Connect 4 game, `og_sample`.

The functions in `html/callAPI.js` can be tried from the browser console on
http://localhost:8080, for example `await getOpenGames()`.

## How it fits together

`compose.yaml` runs four containers:

- **dynamodb**: AWS's DynamoDB Local.
- **db-init** (`db/local_db.py`): creates any missing tables, then exits.
- **lambda**: the code from `lambdas/siteAPI/src/`, running in AWS's official
  Lambda Python image. That image includes the Lambda Runtime Interface Emulator.
- **gateway** (`gateway/gateway.py`): serves `html/`, and turns each HTTP request
  to port 3000 into an API Gateway (payload format 2.0) event for the Lambda.
  It also handles CORS, the way the deployed API needs to.

The Lambda finds DynamoDB Local through the `DYNAMODB_ENDPOINT_URL`
environment variable. When that variable isn't set, as in AWS, it uses real
DynamoDB.

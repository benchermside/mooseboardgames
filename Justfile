set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

site_api := "lambdas/siteAPI"
site_api_function_name := "mooseboardgames-siteAPI-dev"
compose := "docker compose -f local/compose.yaml"

# List just commands
default:
    @just --list

# Run the whole site locally: site on :8080, API on :3000, DynamoDB on :8000 (Ctrl+C to stop)
dev:
    {{compose}} up --build --watch

# Stop and remove the local containers (local data is kept)
down:
    {{compose}} down

# Put the local DynamoDB tables back to just the sample data
db-reset:
    {{compose}} run --rm db-init python local_db.py --reset

# Run all tests
test:
    cd {{site_api}}; uv run pytest tests/ -v

# Package src/ + dependencies into deployment.zip for Lambda upload
build:
    uv run --no-project python deploy/build.py

# Build siteAPI and upload deployment.zip to the Lambda function
deploy: build
    cd {{site_api}}; aws lambda update-function-code --function-name {{site_api_function_name}} --zip-file fileb://deployment.zip

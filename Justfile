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

# Play a game locally against yourself: `just play ur` or `just play starvethefox` (Ctrl+C to stop)
play game:
    npm run play -w games/{{game}}

# Run all tests
test:
    cd {{site_api}}; uv run pytest tests/ -v
    npm test -w game-server

# Package src/ + dependencies into deployment.zip for Lambda upload
build:
    uv run --no-project python deploy/build.py

# Build siteAPI and upload deployment.zip to the Lambda function
deploy: build
    cd {{site_api}}; aws lambda update-function-code --function-name {{site_api_function_name}} --zip-file fileb://deployment.zip

# Upload html/ (the lobby page) to the site and clear CloudFront's cached copies. env: dev
deploy-site env="dev":
    $site = (terraform -chdir=infra/envs/{{env}} output -json site | ConvertFrom-Json); aws s3 sync html/ "s3://$($site.site_bucket)" --delete; if ($LASTEXITCODE -eq 0) { aws cloudfront create-invalidation --distribution-id $site.site_distribution_id --paths "/*" --query "Invalidation.Id" --output text }

# Show what Terraform would change in AWS (changes nothing). env: dev
infra-plan env="dev":
    cd infra/envs/{{env}}; terraform plan

# Apply Terraform changes to AWS, after showing the plan and asking. env: dev
infra-apply env="dev":
    cd infra/envs/{{env}}; terraform apply

# Build the game-server image (game-server/) and push it to ECR as :latest. env: dev
push-image env="dev":
    $repo = (terraform -chdir=infra/envs/{{env}} output -json game_host | ConvertFrom-Json).ecr_repository_url; $registry = $repo.Split('/')[0]; cmd /c "aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $registry"; if ($LASTEXITCODE -eq 0) { docker buildx build --platform linux/arm64 --provenance=false -f game-server/Dockerfile -t "${repo}:latest" --push . }

set windows-shell := ["powershell.exe", "-NoLogo", "-Command"]

site_api := "lambdas/siteAPI"
site_api_function_name := "mooseboardgames-siteAPI.dev"

# List just commands
default:
    @just --list

# Run all tests
test:
    cd {{site_api}}; uv run pytest tests/ -v

# Package src/ + dependencies into deployment.zip for Lambda upload
build:
    cd {{site_api}}; $hash = (Get-FileHash uv.lock -Algorithm SHA256).Hash; if ((Test-Path package/.deps-hash) -and ((Get-Content package/.deps-hash) -eq $hash)) { Write-Host "Dependencies unchanged, skipping install" } else { if (Test-Path package) { Remove-Item -Recurse -Force package }; $deps = uv export --no-dev --no-hashes --no-emit-project --frozen | Where-Object { $_ -match "^[A-Za-z0-9].*==" -and $_ -notmatch "^(boto3|botocore|s3transfer|jmespath)==" }; if ($deps) { uv pip install --target package $deps } else { New-Item -ItemType Directory -Force package | Out-Null }; Set-Content package/.deps-hash $hash }
    cd {{site_api}}; if (Test-Path deployment.zip) { Remove-Item deployment.zip }
    cd {{site_api}}; uv run python build_zip.py deployment.zip package src
    cd {{site_api}}; Write-Host "Built deployment.zip"

# Build siteAPI and upload deployment.zip to the Lambda function
deploy: build
    cd {{site_api}}; aws lambda update-function-code --function-name {{site_api_function_name}} --zip-file fileb://deployment.zip


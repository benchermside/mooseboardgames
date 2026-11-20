# Infrastructure (Terraform)

All of the site's AWS resources are defined here. Make changes in these files and apply them with Terraform, not in the AWS console. A change made in the console shows up as a difference in the next `plan`, and Terraform undoes it on the next `apply`.

| Path | What it is |
|------|------------|
| `bootstrap/` | The S3 bucket that stores Terraform's state. Run once. |
| `modules/site/` | One environment: the HTML bucket and distribution, the siteAPI Lambda and its distribution, the DynamoDB tables, and DNS. |
| `modules/game_host/` | Running one game-server task per match: the security group, ECR, ECS cluster and task definition, the matches table, and the Lambda@Edge router (code in `lambdas/router/`). The site module adds the `/m/*` route that uses them. |
| `envs/dev/` | The dev environment (`dev.mooseboardgames.com`). |

## Prerequisites

- Terraform 1.10 or later.
- The AWS CLI, signed in to the account. `aws sts get-caller-identity` should work.

## First-time setup

1. Create the state bucket (from the repo root):
   ```powershell
   cd infra/bootstrap
   terraform init
   terraform apply
   ```
   It shows one bucket and three settings on it. Type `yes`.
2. Initialize dev:
   ```powershell
   cd ../envs/dev
   terraform init
   ```

## Everyday use

From the repo root:

```powershell
just infra-plan    # show what would change. Changes nothing.
just infra-apply   # show the plan, then apply it if you type yes
```

Always read the plan before typing `yes`. Look for:
- `destroy` or `must be replaced`. These delete something. For a table, they delete its data.
- Changes you didn't make. Someone (or something) changed that resource outside Terraform.

## What Terraform does not manage

- **The siteAPI code.** Terraform owns the function's settings; `just deploy` uploads the code.
- **The game-server image.** Terraform creates the ECR repository; `just push-image` builds and pushes the image. The router's code *is* managed here: change `lambdas/router/index.mjs`, then `just infra-apply`.
- **Lambda@Edge log groups.** The router logs to `/aws/lambda/us-east-1.mooseboardgames-router-<env>` in whichever region served each request, so those groups are created on demand and have no retention limit.
- **The HTML files** in the site bucket.
- **The Route 53 hosted zone and the `*.mooseboardgames.com` certificate.** They're looked up, not managed, because every environment shares them.
- **The WAF web ACLs** attached to the distributions. They were created by the console, and Terraform only references them.
- **Prod.** `mooseboardgames.com` was set up in the console and isn't managed here yet.

## Importing resources made in the console

`envs/dev/imports.tf` adopted the dev resources that were created in the console before Terraform. After the first successful `apply`, its blocks do nothing, and the file can be deleted.

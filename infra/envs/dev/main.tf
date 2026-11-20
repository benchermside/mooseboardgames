# The dev environment: dev.mooseboardgames.com and dev-api.mooseboardgames.com.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # Created by infra/bootstrap.
  backend "s3" {
    bucket       = "mooseboardgames-tfstate-471112651283"
    key          = "dev/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = "us-east-1"
  # Tags every resource, so the project's costs can be filtered in Cost Explorer.
  default_tags {
    tags = {
      mooseboardgames = ""
    }
  }
}

module "site" {
  source = "../../modules/site"

  env              = "dev"
  site_domain      = "dev.mooseboardgames.com"
  api_domain       = "dev-api.mooseboardgames.com"
  site_bucket_name = "mooseboardgames.com-dev"

  # Web ACLs the console created when the distributions were made.
  site_web_acl_id = "arn:aws:wafv2:us-east-1:471112651283:global/webacl/CreatedByCloudFront-054f9163/ef6b7dd3-59c7-4aee-af26-37f2148001dd"
  api_web_acl_id  = "arn:aws:wafv2:us-east-1:471112651283:global/webacl/CreatedByCloudFront-66fbb0d5/dc260923-1570-4df6-87d1-bb6ab90b66ea"

  # Names the console generated, kept so nothing gets replaced.
  site_origin_id  = "mooseboardgames.com-dev.s3.us-east-1.amazonaws.com-mqwsawatu2r"
  api_origin_id   = "lcbpa3mn4xfe4w5bp33a2wtmba0dpkgc.lambda-url.us-east-1.on.aws-mv31y74ykzw"
  oac_name        = "oac-mooseboardgames.com-dev.s3.us-east-1.amazonaws.c-mqwsovbe3rm"
  api_role_name   = "mooseboardgames-siteAPI"
  api_policy_name = "mooseboardgames-siteAPIPolicy"

  # /m/* on dev.mooseboardgames.com goes to the game servers.
  game_route = module.game_host.route
}

module "game_host" {
  source = "../../modules/game_host"
  env    = "dev"
}

# The matches table started out in the site module.
moved {
  from = module.site.aws_dynamodb_table.matches
  to   = module.game_host.aws_dynamodb_table.matches
}

output "site" {
  value = module.site
}

output "game_host" {
  value = module.game_host
}

# Config for spikes/aws/launch-and-measure.js, to run spike S1 (design T5a)
# against dev. Write it with:
#   terraform output -raw launch_config > ../../../spikes/aws/config.dev.json
output "launch_config" {
  value = jsonencode({
    region           = "us-east-1"
    cluster          = module.game_host.cluster
    taskDefinition   = module.game_host.task_definition_family
    containerName    = module.game_host.container_name
    subnets          = module.game_host.subnet_ids
    securityGroup    = module.game_host.security_group_id
    table            = module.game_host.matches_table
    recordSchema     = "real"
    cloudFrontDomain = "dev.mooseboardgames.com"
  })
}

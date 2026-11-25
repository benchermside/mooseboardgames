# Everything needed to run one game-server task per match (design Phase 1,
# T1–T5), except the /m/* route on the site's distribution, which the site
# module adds using this module's outputs.

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    archive = {
      source = "hashicorp/archive"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name           = "mooseboardgames-game-server-${var.env}"
  container_name = "game-server"
  container_port = 8000
  # A plain value, not the table resource's attribute, so the router bundle
  # (router.tf) doesn't wait on, and get rebuilt after, every table change.
  matches_table_name = "mooseboardgames-matches-${var.env}"
}

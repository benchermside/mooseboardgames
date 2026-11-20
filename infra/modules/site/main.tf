# The site for one environment: the HTML bucket and its CloudFront
# distribution, the siteAPI Lambda and its distribution, the DynamoDB tables,
# and the DNS records.

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

data "aws_route53_zone" "main" {
  name = var.zone_name
}

# The *.mooseboardgames.com certificate. CloudFront needs it in us-east-1.
data "aws_acm_certificate" "main" {
  domain      = var.zone_name
  statuses    = ["ISSUED"]
  most_recent = true
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  api_function_name = "mooseboardgames-siteAPI-${var.env}"
  api_role_name     = coalesce(var.api_role_name, "mooseboardgames-siteAPI-${var.env}")
  api_policy_name   = coalesce(var.api_policy_name, "mooseboardgames-siteAPIPolicy-${var.env}")
  oac_name          = coalesce(var.oac_name, "oac-${var.site_bucket_name}")
  game_origin_id    = "game-server"
}

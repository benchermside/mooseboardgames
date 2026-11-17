# Resources created in the console before Terraform, adopted as-is.
# After the first successful `terraform apply`, these blocks do nothing and can
# be deleted.

locals {
  zone_id = "Z04544033DG4W57Y74P3N" # mooseboardgames.com
}

import {
  to = module.site.aws_s3_bucket.site
  id = "mooseboardgames.com-dev"
}
import {
  to = module.site.aws_s3_bucket_public_access_block.site
  id = "mooseboardgames.com-dev"
}
import {
  to = module.site.aws_s3_bucket_ownership_controls.site
  id = "mooseboardgames.com-dev"
}
import {
  to = module.site.aws_s3_bucket_server_side_encryption_configuration.site
  id = "mooseboardgames.com-dev"
}
import {
  to = module.site.aws_s3_bucket_policy.site
  id = "mooseboardgames.com-dev"
}
import {
  to = module.site.aws_cloudfront_origin_access_control.site
  id = "E2I5HTEP4CAV6M"
}
import {
  to = module.site.aws_cloudfront_distribution.site
  id = "E13FCYUJNASCZ7"
}
import {
  for_each = toset(["A", "AAAA"])
  to       = module.site.aws_route53_record.site[each.key]
  id       = "${local.zone_id}_dev.mooseboardgames.com_${each.key}"
}

import {
  to = module.site.aws_iam_role.api
  id = "mooseboardgames-siteAPI"
}
import {
  to = module.site.aws_iam_policy.api
  id = "arn:aws:iam::471112651283:policy/mooseboardgames-siteAPIPolicy"
}
import {
  to = module.site.aws_iam_role_policy_attachment.api_tables
  id = "mooseboardgames-siteAPI/arn:aws:iam::471112651283:policy/mooseboardgames-siteAPIPolicy"
}
import {
  to = module.site.aws_iam_role_policy_attachment.api_logs
  id = "mooseboardgames-siteAPI/arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
import {
  to = module.site.aws_cloudwatch_log_group.api
  id = "/aws/lambda/mooseboardgames-siteAPI-dev"
}
import {
  to = module.site.aws_lambda_function.api
  id = "mooseboardgames-siteAPI-dev"
}
import {
  to = module.site.aws_lambda_function_url.api
  id = "mooseboardgames-siteAPI-dev"
}
import {
  to = module.site.aws_lambda_permission.api_url_public
  id = "mooseboardgames-siteAPI-dev/FunctionURLAllowPublicAccess"
}
import {
  to = module.site.aws_lambda_permission.api_url_invoke
  id = "mooseboardgames-siteAPI-dev/FunctionURLAllowInvokeAction"
}
import {
  to = module.site.aws_cloudfront_distribution.api
  id = "EEWTPRXKIJ4HX"
}
import {
  for_each = toset(["A", "AAAA"])
  to       = module.site.aws_route53_record.api[each.key]
  id       = "${local.zone_id}_dev-api.mooseboardgames.com_${each.key}"
}

import {
  to = module.site.aws_dynamodb_table.site["open_games"]
  id = "mooseboardgames-open_games-dev"
}

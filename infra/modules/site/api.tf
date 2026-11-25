# The siteAPI: a Python Lambda behind a function URL, fronted by CloudFront.
#
# Terraform owns the function's configuration, not its code. `just deploy`
# uploads the code. A brand-new environment starts with a placeholder that
# answers 503 until the first `just deploy`.

data "archive_file" "api_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.build/api-placeholder.zip"
  source {
    filename = "lambda_function.py"
    content  = <<-EOT
      def lambda_handler(event, context):
          return {"statusCode": 503, "body": "Not deployed yet. Run: just deploy"}
    EOT
  }
}

resource "aws_iam_role" "api" {
  name = local.api_role_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "api" {
  name = local.api_policy_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "Statement1"
      Effect = "Allow"
      Action = [
        "dynamodb:BatchGetItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchWriteItem",
        "dynamodb:DeleteItem",
        "dynamodb:PartiQLDelete",
        "dynamodb:PartiQLInsert",
        "dynamodb:PartiQLUpdate",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
      ]
      # TODO before adding prod: narrow this to "mooseboardgames-*-${var.env}"
      # so dev's API can't touch prod's tables.
      Resource = [
        "arn:aws:dynamodb:*:${data.aws_caller_identity.current.account_id}:table/mooseboardgames-*",
        "arn:aws:dynamodb:*:${data.aws_caller_identity.current.account_id}:table/mooseboardgames-*/index/*",
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_tables" {
  role       = aws_iam_role.api.name
  policy_arn = aws_iam_policy.api.arn
}

# Creating an open game starts its game-server task (T10).
resource "aws_iam_role_policy_attachment" "api_launch_games" {
  count      = var.game_launch == null ? 0 : 1
  role       = aws_iam_role.api.name
  policy_arn = var.game_launch.policy_arn
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.api_function_name}"
  retention_in_days = 7
}

resource "aws_lambda_function" "api" {
  function_name = local.api_function_name
  role          = aws_iam_role.api.arn
  runtime       = "python3.14"
  handler       = "lambda_function.lambda_handler"
  architectures = ["arm64"]
  memory_size   = 128
  # Creating an open game waits for RunTask, which usually takes under a second.
  timeout = 10

  # Game-server settings for lambdas/siteAPI/src/game_launcher.py.
  dynamic "environment" {
    for_each = var.game_launch == null ? [] : [var.game_launch]
    content {
      variables = {
        GAME_CLUSTER         = environment.value.cluster
        GAME_TASK_DEFINITION = environment.value.task_definition
        GAME_CONTAINER_NAME  = environment.value.container_name
        GAME_SUBNETS         = join(",", environment.value.subnet_ids)
        GAME_SECURITY_GROUP  = environment.value.security_group_id
      }
    }
  }

  filename         = data.archive_file.api_placeholder.output_path
  source_code_hash = data.archive_file.api_placeholder.output_base64sha256

  # The real code comes from `just deploy`, so don't put the placeholder back.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
  # The lobby page (on the site's domain) calls the API with the login cookie.
  # Browsers allow that only if the API names the page's origin exactly (not
  # "*") and allows credentials.
  cors {
    allow_origins     = ["https://${var.site_domain}"]
    allow_credentials = true
    allow_methods     = ["GET", "POST", "PUT", "DELETE"]
    allow_headers     = ["content-type"]
  }
}

# Function URLs with auth type NONE need both of these to be publicly callable.
resource "aws_lambda_permission" "api_url_public" {
  statement_id           = "FunctionURLAllowPublicAccess"
  function_name          = aws_lambda_function.api.function_name
  action                 = "lambda:InvokeFunctionUrl"
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "api_url_invoke" {
  statement_id             = "FunctionURLAllowInvokeAction"
  function_name            = aws_lambda_function.api.function_name
  action                   = "lambda:InvokeFunction"
  principal                = "*"
  invoked_via_function_url = true
}

locals {
  # "https://abc.lambda-url.us-east-1.on.aws/" -> "abc.lambda-url.us-east-1.on.aws"
  api_url_host = split("/", aws_lambda_function_url.api.function_url)[2]
}

resource "aws_cloudfront_distribution" "api" {
  comment         = "mooseboardgames_${var.env}_api"
  enabled         = true
  aliases         = [var.api_domain]
  http_version    = "http2"
  is_ipv6_enabled = true
  price_class     = "PriceClass_All"
  web_acl_id      = var.api_web_acl_id
  tags = {
    Name = "mooseboardgames_${var.env}_api"
  }

  origin {
    origin_id   = var.api_origin_id
    domain_name = local.api_url_host
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      ip_address_type        = "ipv4"
    }
  }

  default_cache_behavior {
    target_origin_id         = var.api_origin_id
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.main.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

resource "aws_route53_record" "api" {
  for_each = toset(["A", "AAAA"])

  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.api_domain
  type    = each.key
  alias {
    name                   = aws_cloudfront_distribution.api.domain_name
    zone_id                = aws_cloudfront_distribution.api.hosted_zone_id
    evaluate_target_health = false
  }
}

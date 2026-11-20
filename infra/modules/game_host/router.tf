# T5. The Lambda@Edge router. The site module attaches it to the /m/* route.
#
# There's no custom origin request policy here: the dev site distribution is
# on CloudFront's Free flat-rate plan, which allows only AWS managed policies.
# The site module uses the managed AllViewerExceptHostHeader policy instead,
# which forwards the WebSocket handshake headers and all query strings.

# The code is lambdas/router/index.mjs, plus a generated config.json, because
# Lambda@Edge has no environment variables.
data "archive_file" "router" {
  type        = "zip"
  output_path = "${path.module}/.build/router.zip"
  source {
    filename = "index.mjs"
    content  = file("${path.module}/../../../lambdas/router/index.mjs")
  }
  source {
    filename = "config.json"
    content = jsonencode({
      table       = aws_dynamodb_table.matches.name
      tableRegion = data.aws_region.current.region
      originPort  = local.container_port
    })
  }
}

resource "aws_iam_role" "router" {
  name = "mooseboardgames-router-${var.env}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"]
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "router" {
  name = "router-access"
  role = aws_iam_role.router.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadMatches"
        Effect   = "Allow"
        Action   = "dynamodb:GetItem"
        Resource = aws_dynamodb_table.matches.arn
      },
      {
        # Lambda@Edge logs to /aws/lambda/us-east-1.<name> in whichever
        # region served the request.
        Sid      = "WriteLogsInAnyEdgeRegion"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/us-east-1.mooseboardgames-router-${var.env}:*"
      },
    ]
  })
}

# Must be in us-east-1 and x86_64. CloudFront needs a numbered version, so
# publish = true makes a new version whenever the code or config changes.
resource "aws_lambda_function" "router" {
  function_name    = "mooseboardgames-router-${var.env}"
  role             = aws_iam_role.router.arn
  runtime          = "nodejs24.x"
  handler          = "index.handler"
  architectures    = ["x86_64"]
  memory_size      = 128
  timeout          = 5
  publish          = true
  filename         = data.archive_file.router.output_path
  source_code_hash = data.archive_file.router.output_base64sha256
}

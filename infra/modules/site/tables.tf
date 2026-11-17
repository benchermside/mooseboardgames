# DynamoDB tables. Names must match the constants in lambdas/siteAPI/src and
# the local tables in local/db/local_db.py.

locals {
  # table short name -> partition key (all keys are strings)
  site_tables = {
    open_games = "open_game_id"
    user       = "user_id"
    username   = "username"
    session    = "session_id"
  }
}

resource "aws_dynamodb_table" "site" {
  for_each = local.site_tables

  name         = "mooseboardgames-${each.key}-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = each.value

  attribute {
    name = each.value
    type = "S"
  }
}

# One record per game-server match: status, task ARN, origin host, and so on.
# See documentation/fargate-host-design.md (T3). The Lambda@Edge router reads
# this table, so it's kept apart from the lobby's tables.
resource "aws_dynamodb_table" "matches" {
  name         = "mooseboardgames-matches-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "match_id"

  attribute {
    name = "match_id"
    type = "S"
  }
}

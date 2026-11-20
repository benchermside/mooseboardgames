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

# The matches table is in modules/game_host.

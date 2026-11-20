# T3. One record per match: status, task ARN, origin host, and so on.
# See documentation/fargate-host-design.md. The Lambda@Edge router reads this
# table, so it's kept apart from the lobby's tables.

resource "aws_dynamodb_table" "matches" {
  name         = "mooseboardgames-matches-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "match_id"

  attribute {
    name = "match_id"
    type = "S"
  }
}

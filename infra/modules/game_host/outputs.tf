output "matches_table" {
  value = aws_dynamodb_table.matches.name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.game_server.repository_url
}

output "cluster" {
  value = aws_ecs_cluster.games.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.game_server.family
}

output "container_name" {
  value = local.container_name
}

output "subnet_ids" {
  value = data.aws_subnets.tasks.ids
}

output "security_group_id" {
  value = aws_security_group.tasks.id
}

# What the site module needs so the lobby can start game-server tasks (T10).
output "launch" {
  value = {
    cluster           = aws_ecs_cluster.games.name
    task_definition   = aws_ecs_task_definition.game_server.family
    container_name    = local.container_name
    subnet_ids        = data.aws_subnets.tasks.ids
    security_group_id = aws_security_group.tasks.id
    policy_arn        = aws_iam_policy.launch_tasks.arn
  }
}

# What the site module needs to add the /m/* route.
output "route" {
  value = {
    router_arn  = aws_lambda_function.router.qualified_arn
    origin_port = local.container_port
  }
}

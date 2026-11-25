# T10. What the lobby (the siteAPI Lambda) needs to start a game-server task
# when a player creates an open game. The site module attaches this policy to
# the siteAPI's role and passes the settings to it as environment variables.

resource "aws_iam_policy" "launch_tasks" {
  name        = "mooseboardgames-launch-game-servers-${var.env}"
  description = "Start game-server tasks in the ${aws_ecs_cluster.games.name} cluster."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Any revision of the game-server task definition, only in this cluster.
        Sid      = "RunGameServerTasks"
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.game_server.family}:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.games.arn }
        }
      },
      {
        # RunTask's tag (match_id) needs this, but only when starting a task.
        Sid      = "TagNewTasks"
        Effect   = "Allow"
        Action   = "ecs:TagResource"
        Resource = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task/${aws_ecs_cluster.games.name}/*"
        Condition = {
          StringEquals = { "ecs:CreateAction" = "RunTask" }
        }
      },
      {
        # RunTask hands the task its two roles.
        Sid      = "PassTaskRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
    ]
  })
}

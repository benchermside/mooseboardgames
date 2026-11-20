# T2. The image repository, cluster, roles, logs, and task definition.
# Tasks are started one per match with RunTask; there is no ECS service.

resource "aws_ecr_repository" "game_server" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"
}

# Old images only cost storage. Keep the newest 10.
resource "aws_ecr_lifecycle_policy" "game_server" {
  repository = aws_ecr_repository.game_server.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "games" {
  name = "mooseboardgames-${var.env}"
  # Container Insights costs extra; not needed yet.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "game_server" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself to pull the image and write logs.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Used by the game server's own code: it reads and updates its match record.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "task_matches" {
  name = "matches-table"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.matches.arn
    }]
  })
}

resource "aws_ecs_task_definition" "game_server" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name      = local.container_name
    image     = "${aws_ecr_repository.game_server.repository_url}:${var.image_tag}"
    essential = true
    portMappings = [{
      containerPort = local.container_port
      protocol      = "tcp"
    }]
    # MATCH_ID is added per task by RunTask.
    environment = [
      { name = "PORT", value = tostring(local.container_port) },
      { name = "MATCHES_TABLE", value = aws_dynamodb_table.matches.name },
    ]
    stopTimeout = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.game_server.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

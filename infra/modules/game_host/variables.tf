variable "env" {
  description = "Environment name, used as a suffix on resource names: dev or prod."
  type        = string
}

variable "task_availability_zones" {
  description = <<-EOT
    Default-VPC subnets in these AZs run game tasks. Leave out us-east-1e: in
    this account it is AZ use1-az3, which doesn't support Fargate.
  EOT
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "image_tag" {
  description = "Tag of the game-server image in ECR that new tasks run."
  type        = string
  default     = "latest"
}

variable "log_retention_days" {
  type    = number
  default = 7
}

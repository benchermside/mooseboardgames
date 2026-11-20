# T1. Game tasks run in the default VPC's public subnets with a public IP
# (no NAT gateway), and a security group that admits only CloudFront.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "tasks" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone"
    values = var.task_availability_zones
  }
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "tasks" {
  name        = "${local.name}-tasks"
  description = "Game-server tasks: port ${local.container_port} from CloudFront only"
  vpc_id      = data.aws_vpc.default.id

  lifecycle {
    # D6: the router needs each task's public DNS name, which only exists
    # when the VPC has DNS hostnames turned on.
    precondition {
      condition     = data.aws_vpc.default.enable_dns_hostnames && data.aws_vpc.default.enable_dns_support
      error_message = "The default VPC must have DNS hostnames and DNS resolution enabled."
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_cloudfront" {
  security_group_id = aws_security_group.tasks.id
  description       = "CloudFront origin-facing servers"
  ip_protocol       = "tcp"
  from_port         = local.container_port
  to_port           = local.container_port
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

# Outbound is needed to pull the image and to reach DynamoDB and CloudWatch Logs.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.tasks.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

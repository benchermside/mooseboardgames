# One-time setup: the S3 bucket that holds every environment's Terraform state.
#
# Run once (see infra/README.md). This folder's own state is kept locally in
# terraform.tfstate, which is gitignored. If it's ever lost, nothing breaks:
# the bucket keeps working, and it can be imported again.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "mooseboardgames-tfstate-${data.aws_caller_identity.current.account_id}"

  # Deleting this bucket would orphan every environment's state.
  lifecycle {
    prevent_destroy = true
  }
}

# Keep old versions of the state so a bad apply can be rolled back.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.92"
    }
  }

  required_version = ">= 1.2"

  backend "s3" {
    bucket       = "427040638965-terraform"
    key          = "infra-core-api"
    region       = "us-east-1"
    use_lockfile = true
  }
}


provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      project           = var.ProjectId
      terraform_managed = true
    }
  }
}

resource "aws_cloudwatch_log_group" "main_app_logs" {
  name              = "/aws/lambda/${var.ProjectId}-lambda"
  retention_in_days = var.LogRetentionDays
}
module "sqs_queues" {
  source          = "../../modules/sqs"
  resource_prefix = var.ProjectId
}

module "lambda_warmer" {
  source           = "github.com/acm-uiuc/terraform-modules/lambda-warmer?ref=v0.1.1"
  function_to_warm = "infra-core-api-lambda"
}
module "dynamo" {
  source    = "../../modules/dynamo"
  ProjectId = var.ProjectId
}

resource "random_password" "origin_verify_key" {
  length  = 20
  special = false
  keepers = {
    force_recreation = uuid()
  }
}

module "lambdas" {
  source           = "../../modules/lambdas"
  ProjectId        = var.ProjectId
  RunEnvironment   = "dev"
  LinkryKvArn      = "arn:aws:cloudfront::427040638965:key-value-store/0c2c02fd-7c47-4029-975d-bc5d0376bba1"
  OriginVerifyKey  = random_password.origin_verify_key.result
  LogRetentionDays = 30
}

// This section last: moved records into modules
moved {
  from = aws_dynamodb_table.app_audit_log
  to   = module.dynamo.aws_dynamodb_table.app_audit_log
}

moved {
  from = aws_dynamodb_table.membership_provisioning_log
  to   = module.dynamo.aws_dynamodb_table.membership_provisioning_log
}


moved {
  from = aws_dynamodb_table.api_keys
  to   = module.dynamo.aws_dynamodb_table.api_keys
}

moved {
  from = aws_dynamodb_table.room_requests
  to   = module.dynamo.aws_dynamodb_table.room_requests
}

moved {
  from = aws_dynamodb_table.room_requests_status
  to   = module.dynamo.aws_dynamodb_table.room_requests_status
}

moved {
  from = aws_dynamodb_table.external_membership
  to   = module.dynamo.aws_dynamodb_table.external_membership
}

moved {
  from = aws_dynamodb_table.iam_group_roles
  to   = module.dynamo.aws_dynamodb_table.iam_group_roles
}

moved {
  from = aws_dynamodb_table.iam_user_roles
  to   = module.dynamo.aws_dynamodb_table.iam_user_roles
}

moved {
  from = aws_dynamodb_table.events
  to   = module.dynamo.aws_dynamodb_table.events
}

moved {
  from = aws_dynamodb_table.stripe_links
  to   = module.dynamo.aws_dynamodb_table.stripe_links
}

moved {
  from = aws_dynamodb_table.linkry_records
  to   = module.dynamo.aws_dynamodb_table.linkry_records
}


moved {
  from = aws_dynamodb_table.cache
  to   = module.dynamo.aws_dynamodb_table.cache
}

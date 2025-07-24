data "aws_caller_identity" "current" {}
locals {
  account_id = data.aws_caller_identity.current.account_id
}

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.92"
    }
  }

  required_version = ">= 1.2"
  backend "s3" {
    bucket       = "298118738376-terraform"
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
import {
  to = aws_cloudwatch_log_group.main_app_logs
  id = "/aws/lambda/${var.ProjectId}-lambda"
}
resource "aws_cloudwatch_log_group" "main_app_logs" {
  name              = "/aws/lambda/${var.ProjectId}-lambda"
  retention_in_days = var.LogRetentionDays
}

module "app_alarms" {
  source                          = "../../modules/alarms"
  main_cloudfront_distribution_id = var.main_cloudfront_distribution_id
  resource_prefix                 = var.ProjectId
  priority_sns_arn                = var.GeneralSNSAlertArn
  standard_sns_arn                = var.PrioritySNSAlertArn
}

module "sqs_queues" {
  source          = "../../modules/sqs"
  resource_prefix = var.ProjectId
}

module "dynamo" {
  source    = "../../modules/dynamo"
  ProjectId = var.ProjectId
}

import {
  id = "${var.ProjectId}-membership-external-v3"
  to = aws_dynamodb_table.external_membership
}
resource "aws_dynamodb_table" "external_membership" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-membership-external-v3"
  deletion_protection_enabled = true
  hash_key                    = "memberList"
  range_key                   = "netId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "netId"
    type = "S"
  }

  attribute {
    name = "memberList"
    type = "S"
  }

  global_secondary_index {
    name            = "invertedIndex"
    hash_key        = "netId"
    range_key       = "memberList"
    projection_type = "KEYS_ONLY"
  }


  global_secondary_index {
    name            = "keysOnlyIndex"
    hash_key        = "memberList"
    projection_type = "KEYS_ONLY"
  }

}

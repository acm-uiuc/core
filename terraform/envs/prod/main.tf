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

module "lambda_warmer" {
  source           = "github.com/acm-uiuc/terraform-modules/lambda-warmer?ref=v0.1.1"
  function_to_warm = "infra-core-api-lambda"
}
import {
  id = "${var.ProjectId}-membership-external-v3"
  to = aws_dynamodb_table.external_membership
}

import {
  id = "${var.ProjectId}-iam-grouproles"
  to = aws_dynamodb_table.iam_group_roles
}

import {
  id = "${var.ProjectId}-iam-userroles"
  to = aws_dynamodb_table.iam_user_roles
}

import {
  id = "${var.ProjectId}-events"
  to = aws_dynamodb_table.events
}

import {
  id = "${var.ProjectId}-stripe-links"
  to = aws_dynamodb_table.stripe_links
}

import {
  id = "${var.ProjectId}-linkry"
  to = aws_dynamodb_table.linkry_records
}

import {
  id = "${var.ProjectId}-cache"
  to = aws_dynamodb_table.cache
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

resource "aws_dynamodb_table" "iam_group_roles" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-iam-grouproles"
  deletion_protection_enabled = true
  hash_key                    = "groupUuid"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "groupUuid"
    type = "S"
  }
}

resource "aws_dynamodb_table" "iam_user_roles" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-iam-userroles"
  deletion_protection_enabled = true
  hash_key                    = "userEmail"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userEmail"
    type = "S"
  }
}


resource "aws_dynamodb_table" "events" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-events"
  deletion_protection_enabled = true
  hash_key                    = "id"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "host"
    type = "S"
  }
  global_secondary_index {
    name            = "HostIndex"
    hash_key        = "host"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "stripe_links" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-stripe-links"
  deletion_protection_enabled = true
  hash_key                    = "userId"
  range_key                   = "linkId"

  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "linkId"
    type = "S"
  }
  global_secondary_index {
    name            = "LinkIdIndex"
    hash_key        = "linkId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "linkry_records" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-linkry"
  deletion_protection_enabled = true
  hash_key                    = "slug"
  range_key                   = "access"

  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "slug"
    type = "S"
  }
  attribute {
    name = "access"
    type = "S"
  }

  global_secondary_index {
    name            = "AccessIndex"
    hash_key        = "access"
    range_key       = "slug"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "cache" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-cache"
  deletion_protection_enabled = true
  hash_key                    = "primaryKey"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "primaryKey"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

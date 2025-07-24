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

import {
  to = aws_dynamodb_table.app_audit_log
  id = "${var.ProjectId}-audit-log"
}

resource "aws_dynamodb_table" "app_audit_log" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-audit-log"
  deletion_protection_enabled = true
  hash_key                    = "module"
  range_key                   = "createdAt"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "module"
    type = "S"
  }
  attribute {
    name = "createdAt"
    type = "N"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

module "lambda_warmer" {
  source           = "github.com/acm-uiuc/terraform-modules/lambda-warmer?ref=v0.1.1"
  function_to_warm = "infra-core-api-lambda"
}

// Membership Logs
import {
  to = aws_dynamodb_table.membership_provisioning_log
  id = "${var.ProjectId}-membership-provisioning"
}
resource "aws_dynamodb_table" "membership_provisioning_log" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-membership-provisioning"
  deletion_protection_enabled = true
  hash_key                    = "email"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "email"
    type = "S"
  }
}

// API Keys
import {
  to = aws_dynamodb_table.api_keys
  id = "${var.ProjectId}-keys"
}
resource "aws_dynamodb_table" "api_keys" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-keys"
  deletion_protection_enabled = true
  hash_key                    = "keyId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "keyId"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

// Room Requests
import {
  to = aws_dynamodb_table.room_requests
  id = "${var.ProjectId}-room-requests"
}
import {
  to = aws_dynamodb_table.room_requests_status
  id = "${var.ProjectId}-room-requests-status"
}
resource "aws_dynamodb_table" "room_requests" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-room-requests"
  deletion_protection_enabled = true
  hash_key                    = "semesterId"
  range_key                   = "userId#requestId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userId#requestId"
    type = "S"
  }
  attribute {
    name = "requestId"
    type = "S"
  }
  attribute {
    name = "semesterId"
    type = "S"
  }
  global_secondary_index {
    name            = "RequestIdIndex"
    hash_key        = "requestId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "room_requests_status" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-room-requests-status"
  deletion_protection_enabled = true
  hash_key                    = "requestId"
  range_key                   = "createdAt#status"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "createdAt#status"
    type = "S"
  }
  attribute {
    name = "requestId"
    type = "S"
  }
  attribute {
    name = "semesterId"
    type = "S"
  }
  global_secondary_index {
    name            = "SemesterId"
    hash_key        = "semesterId"
    range_key       = "requestId"
    projection_type = "ALL"
  }
}

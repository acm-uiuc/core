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
    enabled = false
  }
  attribute {
    name = "primaryKey"
    type = "S"
  }
  ttl {
    attribute_name = "expireAt"
    enabled        = true
  }
}

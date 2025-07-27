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

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  bucket_prefix = "${data.aws_caller_identity.current.account_id}-${data.aws_region.current.name}"
}

module "sqs_queues" {
  source                        = "../../modules/sqs"
  resource_prefix               = var.ProjectId
  core_sqs_consumer_lambda_name = module.lambdas.core_sqs_consumer_lambda_name
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
    force_recreation = formatdate("DD-MMM-YYYY", plantimestamp())
  }
}

// TEMPORARY LINKRY KV IMPORT
import {
  to = aws_cloudfront_key_value_store.linkry_kv
  id = "${var.ProjectId}-cloudfront-linkry-kv"
}

resource "aws_cloudfront_key_value_store" "linkry_kv" {
  name = "${var.ProjectId}-cloudfront-linkry-kv"
}
//

module "alarms" {
  source                          = "../../modules/alarms"
  priority_sns_arn                = var.PrioritySNSAlertArn
  resource_prefix                 = var.ProjectId
  main_cloudfront_distribution_id = module.frontend.main_cloudfront_distribution_id
  standard_sns_arn                = var.GeneralSNSAlertArn
  main_lambda_function_name       = module.lambdas.core_api_lambda_name
}

module "lambdas" {
  source           = "../../modules/lambdas"
  ProjectId        = var.ProjectId
  RunEnvironment   = "dev"
  LinkryKvArn      = aws_cloudfront_key_value_store.linkry_kv.arn
  OriginVerifyKey  = random_password.origin_verify_key.result
  LogRetentionDays = 30
  EmailDomain      = var.EmailDomain
}

module "frontend" {
  source             = "../../modules/frontend"
  BucketPrefix       = local.bucket_prefix
  CoreLambdaHost     = module.lambdas.core_function_url
  OriginVerifyKey    = random_password.origin_verify_key.result
  ProjectId          = var.ProjectId
  CoreCertificateArn = var.CoreCertificateArn
  CorePublicDomain   = var.CorePublicDomain
  IcalPublicDomain   = var.IcalPublicDomain
  LinkryPublicDomain = var.LinkryPublicDomain
  LinkryKvArn        = aws_cloudfront_key_value_store.linkry_kv.arn
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

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.9.0"
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
  allowed_account_ids = ["298118738376"]
  region              = "us-east-1"
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
  bucket_prefix = "${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}"
  queue_arns = {
    main = module.sqs_queues.main_queue_arn
    sqs  = module.sqs_queues.sales_email_queue_arn
  }
}

module "sqs_queues" {
  source                        = "../../modules/sqs"
  resource_prefix               = var.ProjectId
  core_sqs_consumer_lambda_name = module.lambdas.core_sqs_consumer_lambda_name
}

module "dynamo" {
  source    = "../../modules/dynamo"
  ProjectId = var.ProjectId
}

module "origin_verify" {
  source    = "../../modules/origin_verify"
  ProjectId = var.ProjectId
}

resource "aws_cloudfront_key_value_store" "linkry_kv" {
  name = "${var.ProjectId}-cloudfront-linkry-kv"
}

module "alarms" {
  source                          = "../../modules/alarms"
  priority_sns_arn                = var.PrioritySNSAlertArn
  resource_prefix                 = var.ProjectId
  main_cloudfront_distribution_id = module.frontend.main_cloudfront_distribution_id
  standard_sns_arn                = var.GeneralSNSAlertArn
  all_lambdas                     = toset([module.lambdas.core_api_lambda_name, module.lambdas.core_api_slow_lambda_name, module.lambdas.core_sqs_consumer_lambda_name])
  performance_noreq_lambdas       = toset([module.lambdas.core_api_lambda_name])
}

module "lambdas" {
  source                           = "../../modules/lambdas"
  ProjectId                        = var.ProjectId
  RunEnvironment                   = "prod"
  LinkryKvArn                      = aws_cloudfront_key_value_store.linkry_kv.arn
  CurrentOriginVerifyKey           = module.origin_verify.current_origin_verify_key
  PreviousOriginVerifyKey          = module.origin_verify.previous_origin_verify_key
  PreviousOriginVerifyKeyExpiresAt = module.origin_verify.previous_invalid_time
  LogRetentionDays                 = 30
  EmailDomain                      = var.EmailDomain
}

module "frontend" {
  source             = "../../modules/frontend"
  BucketPrefix       = local.bucket_prefix
  CoreLambdaHost     = module.lambdas.core_function_url
  OriginVerifyKey    = module.origin_verify.current_origin_verify_key
  ProjectId          = var.ProjectId
  CoreCertificateArn = var.CoreCertificateArn
  CorePublicDomain   = var.CorePublicDomain
  CoreSlowLambdaHost = module.lambdas.core_slow_function_url
  IcalPublicDomain   = var.IcalPublicDomain
  LinkryPublicDomain = var.LinkryPublicDomain
  LinkryKvArn        = aws_cloudfront_key_value_store.linkry_kv.arn
}

resource "aws_lambda_event_source_mapping" "queue_consumer" {
  depends_on              = [module.lambdas, module.sqs_queues]
  for_each                = local.queue_arns
  batch_size              = 5
  event_source_arn        = each.value
  function_name           = module.lambdas.core_sqs_consumer_lambda_arn
  function_response_types = ["ReportBatchItemFailures"]
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

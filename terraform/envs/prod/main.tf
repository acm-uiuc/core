terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.92"
    }
  }

  required_version = ">= 1.2"
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      project = var.ProjectId
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

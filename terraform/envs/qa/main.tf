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

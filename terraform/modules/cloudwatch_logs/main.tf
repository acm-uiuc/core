terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.92"
    }
  }

  required_version = ">= 1.2"
}


import {
  to = aws_cloudwatch_log_group.main_app_logs
  id = "${var.resource_prefix}-logs"
}


resource "aws_cloudwatch_log_group" "main_app_logs" {
  name              = "${var.resource_prefix}-logs"
  retention_in_days = var.retention_in_days
}

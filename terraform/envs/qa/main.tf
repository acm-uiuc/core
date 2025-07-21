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
}

module "cloudwatch_logs" {
  source            = "../../modules/cloudwatch_logs"
  resource_prefix   = var.ResourcePrefix
  retention_in_days = var.LogRetentionDays
}

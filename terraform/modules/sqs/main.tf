terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_sqs_queue" "app_dlq" {
  name                       = "${var.resource_prefix}-sqs-dlq"
  visibility_timeout_seconds = var.sqs_message_timeout
  message_retention_seconds  = 1209600
}

resource "aws_sqs_queue" "app_queue" {
  name                       = "${var.resource_prefix}-sqs"
  visibility_timeout_seconds = var.sqs_message_timeout
  redrive_policy = {
    deadLetterTargetArn = aws_sqs_queue.app_dlq.arn
    maxReceiveCount     = 3
  }
}

resource "aws_sqs_queue" "sales_email_queue" {
  name                       = "${var.resource_prefix}-sqs-sales"
  visibility_timeout_seconds = var.sqs_message_timeout
  redrive_policy = {
    deadLetterTargetArn = aws_sqs_queue.app_dlq.arn
    maxReceiveCount     = 3
  }
}

output "main_queue_arn" {
  description = "Main Queue Arn"
  value       = aws_sqs_queue.app_queue.arn
}

output "dlq_arn" {
  description = "Dead-letter Queue Arn"
  value       = aws_sqs_queue.app_dlq.arn
}

output "sales_email_queue_arn" {
  description = "Sales Email Queue Arn"
  value       = aws_sqs_queue.sales_email_queue.arn
}

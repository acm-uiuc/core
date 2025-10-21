terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "app_dlq_messages_alarm" {
  region              = "us-east-2"
  alarm_name          = "${var.resource_prefix}-sqs-dlq-present"
  alarm_description   = "Items are present in the application DLQ, meaning some messages failed to process."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  dimensions = {
    QueueName = "${var.resource_prefix}-sqs-dlq"
  }
  alarm_actions = [
    var.priority_sns_arn
  ]
  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "app_latency_alarm" {
  region              = "us-east-2"
  for_each            = var.performance_noreq_lambdas
  alarm_name          = "${each.value}-latency-high"
  alarm_description   = "${replace(each.value, "${var.resource_prefix}-", "")} Trailing Mean - 95% API gateway latency is > 1.5s for 2 times in 4 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "UrlRequestLatency"
  extended_statistic  = "tm95"
  period              = "120"
  evaluation_periods  = "2"
  comparison_operator = "GreaterThanThreshold"
  threshold           = "1500"
  alarm_actions = [
    var.standard_sns_arn
  ]
  dimensions = {
    FunctionName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "app_no_requests_alarm" {
  region              = "us-east-2"
  for_each            = var.performance_noreq_lambdas
  alarm_name          = "${each.value}-no-requests"
  alarm_description   = "${replace(each.value, "${var.resource_prefix}-", "")}: no requests have been received in the past 5 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "UrlRequestCount"
  statistic           = "Sum"
  period              = "300"
  evaluation_periods  = "1"
  comparison_operator = "LessThanThreshold"
  threshold           = "1"
  alarm_actions = [
    var.priority_sns_arn
  ]
  dimensions = {
    FunctionName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "app_invocation_error_alarm" {
  region              = "us-east-2"
  for_each            = var.all_lambdas
  alarm_name          = "${each.value}-error-invocation"
  alarm_description   = "${replace(each.value, "${var.resource_prefix}-", "")} lambda threw a critical error."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = "300"
  evaluation_periods  = "1"
  comparison_operator = "GreaterThanThreshold"
  threshold           = "1"
  alarm_actions = [
    var.priority_sns_arn
  ]
  dimensions = {
    FunctionName = each.value
  }
}

resource "aws_cloudwatch_metric_alarm" "app5xx_error_alarm" {
  region              = "us-east-2"
  alarm_name          = "${var.resource_prefix}-cloudfront-5xx-error"
  alarm_description   = "Main application responses are more than 1% 5xx errors (from Cloudfront)"
  namespace           = "AWS/CloudFront"
  metric_name         = "5xxErrorRate"
  statistic           = "Average"
  period              = "300"
  evaluation_periods  = "1"
  comparison_operator = "GreaterThanThreshold"
  threshold           = "1"
  alarm_actions = [
    var.priority_sns_arn
  ]
  dimensions = {
    DistributionId = var.main_cloudfront_distribution_id
  }
}

# firehose alarms
resource "aws_cloudwatch_metric_alarm" "firehost_archival_data_freshness" {
  region              = "us-east-2"
  alarm_name          = "${var.resource_prefix}-firehose-data-stale"
  alarm_description   = "Delivery of archival records to S3 is taking longer than 5 minutes."
  namespace           = "AWS/Firehose"
  metric_name         = "DeliveryToS3.DataFreshness"
  statistic           = "Maximum"
  period              = "300"
  evaluation_periods  = "1"
  comparison_operator = "GreaterThanThreshold"
  threshold           = "300"
  alarm_actions = [
    var.priority_sns_arn
  ]
  dimensions = {
    DeliveryStreamName = var.archival_firehose_stream
  }
}

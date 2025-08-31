variable "resource_prefix" {
  type        = string
  description = "Prefix before each resource"
}

variable "priority_sns_arn" {
  type        = string
  description = "Priority SNS alerts ARN"
}

variable "standard_sns_arn" {
  type        = string
  description = "Standard SNS alerts ARN"
}

variable "main_cloudfront_distribution_id" {
  type        = string
  description = "ID for the cloudfront distribution that serves the main application"
}

variable "all_lambdas" {
  description = "All Lambda functions to monitor for errors."
  type        = set(string)
}

variable "performance_noreq_lambdas" {
  description = "All Lambda functions to monitor for performance/no requests."
  type        = set(string)
}


variable "archival_firehose_stream" {
  description = "Firehose stream to monitor for data archival job."
  type        = string
}

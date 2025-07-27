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

variable "main_lambda_function_name" {
  type = string
}

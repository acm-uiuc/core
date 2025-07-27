variable "resource_prefix" {
  type        = string
  description = "Prefix before each resource"
}

variable "sqs_message_timeout" {
  type        = number
  description = "SQS Message timeout in seconds"
  default     = 720
}

variable "dlq_message_retention" {
  type        = number
  description = "DLQ Message retention in seconds"
  default     = 1209600
}

variable "core_sqs_consumer_lambda_name" {
  type = string
}

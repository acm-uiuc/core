variable "LogRetentionDays" {
  type    = number
  default = 7
}

variable "ProjectId" {
  type    = string
  default = "infra-core-api"
}

variable "main_cloudfront_distribution_id" {
  type        = string
  description = "(temporary) ID for the cloudfront distribution that serves the main application"
}

variable "LogRetentionDays" {
  type    = number
  default = 90
}

variable "ProjectId" {
  type    = string
  default = "infra-core-api"
}

variable "main_cloudfront_distribution_id" {
  type        = string
  description = "(temporary) ID for the cloudfront distribution that serves the main application"
}

variable "GeneralSNSAlertArn" {
  type    = string
  default = "arn:aws:sns:us-east-1:298118738376:infra-monitor-alerts"
}

variable "PrioritySNSAlertArn" {
  type    = string
  default = "arn:aws:sns:us-east-1:298118738376:infra-core-api-priority-alerts"
}

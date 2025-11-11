variable "LogRetentionDays" {
  type    = number
  default = 14
}

variable "ProjectId" {
  type    = string
  default = "infra-core-api"
}

variable "CoreCertificateArn" {
  type    = string
  default = "arn:aws:acm:us-east-1:427040638965:certificate/63ccdf0b-d2b5-44f0-b589-eceffb935c23"
}


variable "LinkryCertificateArn" {
  type    = string
  default = "arn:aws:acm:us-east-1:427040638965:certificate/1aecf0c6-a204-440f-ad0b-fc9157ad93a9"
}

variable "CorePublicDomain" {
  type    = string
  default = "core.aws.qa.acmuiuc.org"
}

variable "LinkryPublicDomain" {
  type    = string
  default = "go.aws.qa.acmuiuc.org"
}

variable "IcalPublicDomain" {
  type    = string
  default = "ical.aws.qa.acmuiuc.org"
}

variable "EmailDomain" {
  type    = string
  default = "aws.qa.acmuiuc.org"
}

variable "GeneralSNSAlertArn" {
  type    = string
  default = "arn:aws:sns:us-east-2:427040638965:infra-monitor-alerts"
}

variable "PrioritySNSAlertArn" {
  type    = string
  default = "arn:aws:sns:us-east-2:427040638965:infra-monitor-alerts"
}

variable "current_active_region" {
  type        = string
  description = "Currently active AWS region"

  validation {
    condition     = contains(["us-east-2", "us-west-2"], var.current_active_region)
    error_message = "Invalid value for current_active_region"
  }
}

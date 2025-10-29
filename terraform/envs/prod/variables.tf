variable "LogRetentionDays" {
  type    = number
  default = 90
}

variable "ProjectId" {
  type    = string
  default = "infra-core-api"
}

variable "GeneralSNSAlertArn" {
  type    = string
  default = "arn:aws:sns:us-east-2:298118738376:infra-monitor-alerts"
}

variable "PrioritySNSAlertArn" {
  type    = string
  default = "arn:aws:sns:us-east-2:298118738376:infra-core-api-priority-alerts"
}


variable "AssetsPublicDomain" {
  type    = string
  default = "assets.acm.illinois.edu"
}


variable "CoreCertificateArn" {
  type    = string
  default = "arn:aws:acm:us-east-1:298118738376:certificate/aeb93d9e-b0b7-4272-9c12-24ca5058c77e"
}

variable "EmailDomain" {
  type    = string
  default = "acm.illinois.edu"
}
variable "CorePublicDomain" {
  type    = string
  default = "core.acm.illinois.edu"
}

variable "LinkryPublicDomain" {
  type    = string
  default = "go.acm.illinois.edu"
}

variable "IcalPublicDomain" {
  type    = string
  default = "ical.acm.illinois.edu"
}

variable "current_active_region" {
  type        = string
  description = "Currently active AWS region"

  validation {
    condition     = contains(["us-east-2", "us-west-2"], var.current_active_region)
    error_message = "Invalid value for current_active_region"
  }
}

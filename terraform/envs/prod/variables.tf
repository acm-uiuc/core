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


variable "CoreCertificateArn" {
  type    = string
  default = "arn:aws:acm:us-east-1:298118738376:certificate/aeb93d9e-b0b7-4272-9c12-24ca5058c77e"
}

// For acm.gg we need a seperate cert for Linkry
variable "LinkryCertificateArn" {
  type    = string
  default = "arn:aws:acm:us-east-1:298118738376:certificate/2b6a2570-53a5-42c6-ba73-3822e6b9691d"
}

variable "EmailDomain" {
  type    = string
  default = "acm.illinois.edu"
}
variable "CorePublicDomain" {
  type    = string
  default = "core.acm.illinois.edu"
}

variable "CoreAssetsPublicDomain" {
  type    = string
  default = "core-assets.acm.illinois.edu"
}

variable "LinkryPublicDomain" {
  type    = string
  default = "go.acm.illinois.edu"
}

variable "IcalPublicDomain" {
  type    = string
  default = "ical.acm.illinois.edu"
}

variable "InvoicePaymentPublicDomain" {
  type    = string
  default = "invoice.acm.gg"
}

variable "current_active_region" {
  type        = string
  description = "Currently active AWS region"

  validation {
    condition     = contains(["us-east-2", "us-west-2"], var.current_active_region)
    error_message = "Invalid value for current_active_region"
  }
}

variable "CloudflareAccountId" {
  type        = string
  description = "Production Cloudflare account receiving InfraTeamMember membership."
  default     = "b17b3669e6fa6f853f6bb063082e95a8"

  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.CloudflareAccountId))
    error_message = "CloudflareAccountId must be a 32-character hexadecimal account ID."
  }
}

variable "CloudflareInfraTeamGroupId" {
  type        = string
  description = "Production Entra InfraTeamMember group ID."

  validation {
    condition     = can(regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", var.CloudflareInfraTeamGroupId))
    error_message = "CloudflareInfraTeamGroupId must be a UUID."
  }
}

variable "CloudflareMemberRoleIds" {
  type        = set(string)
  description = "Cloudflare account member roles assigned to InfraTeamMember invitations."

  validation {
    condition     = length(var.CloudflareMemberRoleIds) > 0 && alltrue([for role_id in var.CloudflareMemberRoleIds : can(regex("^[0-9a-fA-F]{32}$", role_id))])
    error_message = "CloudflareMemberRoleIds must contain at least one 32-character hexadecimal member role ID."
  }
}

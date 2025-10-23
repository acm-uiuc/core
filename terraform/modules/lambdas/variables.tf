variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "LinkryKvArn" {
  type = string
}


variable "RunEnvironment" {
  type = string
  validation {
    condition     = var.RunEnvironment == "dev" || var.RunEnvironment == "prod"
    error_message = "The lambda run environment must be dev or prod."
  }
}

variable "CurrentOriginVerifyKey" {
  type      = string
  sensitive = true
}

variable "PreviousOriginVerifyKey" {
  type      = string
  sensitive = true
}

variable "PreviousOriginVerifyKeyExpiresAt" {
  type = string
}

variable "LogRetentionDays" {
  type = number
}

variable "EmailDomain" {
  type = string
}

variable "LinkryReplicationRegions" {
  type        = set(string)
  description = "A list of regions where the Linkry data has be replicated to (in addition to the primary region)"
}


variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "RunEnvironment" {
  type = string
  validation {
    condition     = var.RunEnvironment == "dev" || var.RunEnvironment == "prod"
    error_message = "The lambda run environment must be dev or prod."
  }
}

variable "PrimaryRegion" {
  type        = string
  description = "primary deployment region"
  default     = "us-east-2"
}

variable "SecondaryRegions" {
  type        = set(string)
  description = "secondary deployment regions"
  default     = ["us-west-2"]
}


variable "DeletionWindowInDays" {
  type        = number
  description = "Number of days before KMS key deletion"
  default     = 20
}

variable "Description" {
  type        = string
  description = "Description for the KMS key"
  default     = "Asymmetric KMS Key for SSH OIDC Certificate Authority"
}


variable "AliasName" {
  type        = string
  default     = "infra-core-api-certificate-root-key"
  description = "Alias name suffix (will be prefixed with 'alias/')"
}

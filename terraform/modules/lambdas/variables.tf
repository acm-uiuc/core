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

variable "OriginVerifyKey" {
  type      = string
  sensitive = true
}

variable "LogRetentionDays" {
  type = number
}

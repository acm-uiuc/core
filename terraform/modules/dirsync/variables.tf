variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "LogRetentionDays" {
  type = number
}

variable "RunEnvironment" {
  type = string
  validation {
    condition     = var.RunEnvironment == "dev" || var.RunEnvironment == "prod"
    error_message = "The lambda run environment must be dev or prod."
  }
}

variable "SyncFrequency" {
  type        = string
  description = "EventBridge cron frequency for triggering the sync lambda"
}

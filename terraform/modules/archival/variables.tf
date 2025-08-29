variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "BucketPrefix" {
  type = string
}

variable "MonitorTables" {
  type        = set(string)
  description = "DynamoDB to monitor expire events for and archive."
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

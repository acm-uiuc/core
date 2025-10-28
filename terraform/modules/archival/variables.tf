variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "BucketPrefix" {
  type = string
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

variable "MonitorTables" {
  type        = set(string)
  description = "DynamoDB to monitor expire events for and archive."
}

variable "TableDeletionDays" {
  type        = map(number)
  description = "Number of days for a given day to hold onto the records once it is put into the bucket."
}

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

variable "region" {
  type        = string
  description = "AWS region to deploy non-global resources to"
}

variable "AdditionalIamPolicies" {
  type = map(string)
}

variable "VendingIotPublishRoleArn" {
  type        = string
  default     = null
  description = "Role in vending account 728393074025 that trusts the Core SQS consumer roles and permits iot:Publish to vending/vending_machine_qa/commands/vend (dev) or vending/vending_machine_prod/commands/vend (prod). Required to process vending jobs."
}

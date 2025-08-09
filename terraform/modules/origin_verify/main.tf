terraform {
  required_providers {
    time = {
      source  = "hashicorp/time"
      version = "~> 0.13.1"
    }
  }
}

locals {
  parameter_name = "/${var.ProjectId}/origin_secret"
}

resource "random_password" "origin_verify_key" {
  length  = 16
  special = false
  keepers = {
    force_recreation = formatdate("DD-MMM-YYYY", plantimestamp())
  }
}

data "external" "ssm_parameter_preread" {
  program = [
    "sh",
    "-c",
    "VALUE=$(aws ssm get-parameter --name \"${local.parameter_name}\" --with-decryption --query Parameter.Value --output text 2>/dev/null) && echo \"{\\\"value\\\":\\\"$VALUE\\\"}\" || echo {}"
  ]
}

resource "time_static" "rotation_timestamp" {
  triggers = {
    previous_key = sha256(try("abc123|${random_password.origin_verify_key.result}|acmuiuc", ""))
  }
}

resource "aws_ssm_parameter" "origin_secret" {
  name        = local.parameter_name
  description = "Origin verify key parameter name"
  type        = "SecureString"
  value       = random_password.origin_verify_key.result
  overwrite   = true
}

output "current_origin_verify_key" {
  description = "The current origin verify key"
  sensitive   = true
  value       = random_password.origin_verify_key.result
}

output "previous_origin_verify_key" {
  description = "The previous origin verify key, which only has a value during a key rotation."
  sensitive   = true
  value       = random_password.origin_verify_key.result != try(data.external.ssm_parameter_preread.result.value, null) ? try(data.external.ssm_parameter_preread.result.value, null) : null
}

output "previous_invalid_time" {
  description = "The timestamp (UTC) after which the previous key should be considered invalid. This is only set during a key rotation."
  value       = random_password.origin_verify_key.result != try(data.external.ssm_parameter_preread.result.value, null) ? timeadd(time_static.rotation_timestamp.rfc3339, "15m") : null
}

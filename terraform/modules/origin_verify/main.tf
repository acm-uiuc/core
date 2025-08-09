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

data "aws_ssm_parameter" "origin_secret_preread" {
  name            = local.parameter_name
  with_decryption = true
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
  description = "The previous origin verify key"
  sensitive   = true
  value       = data.aws_ssm_parameter.origin_secret_preread.arn != null ? data.aws_ssm_parameter.origin_secret_preread.value : random_password.origin_verify_key.result
}

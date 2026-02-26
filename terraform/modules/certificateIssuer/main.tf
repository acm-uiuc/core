data "aws_caller_identity" "current" {}

resource "aws_kms_key" "primary" {
  description              = var.Description
  multi_region             = true
  enable_key_rotation      = false # not supported for asymmetric keys
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "RSA_4096"
  is_enabled               = true
  deletion_window_in_days  = var.DeletionWindowInDays
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = []
  })
}

resource "aws_kms_alias" "primary" {
  name          = "alias/${var.AliasName}"
  target_key_id = aws_kms_key.primary.key_id
}

resource "aws_kms_replica_key" "replica" {
  for_each                = toset(var.SecondaryRegions)
  region                  = each.value
  primary_key_arn         = aws_kms_key.primary.arn
  description             = "${var.Description} (replica)"
  enabled                 = true
  deletion_window_in_days = var.DeletionWindowInDays
}

resource "aws_kms_alias" "replica" {
  for_each      = toset(var.SecondaryRegions)
  region        = each.value
  name          = "alias/${var.AliasName}"
  target_key_id = aws_kms_replica_key.replica[each.key].key_id
}

resource "aws_iam_policy" "kms_sign" {
  name        = "${var.AliasName}-sign"
  description = "Allows kms:Sign and kms:GetPublicKey on all regions of the ${var.AliasName} KMS key"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KmsSignAccess"
        Effect = "Allow"
        Action = ["kms:Sign", "kms:GetPublicKey"]
        Resource = [
          for region in concat([var.PrimaryRegion], tolist(var.SecondaryRegions)) :
          "arn:aws:kms:${region}:${data.aws_caller_identity.current.account_id}:key/${aws_kms_key.primary.key_id}"
        ]
      }
    ]
  })
}

output "kms_sign_policy_arn" {
  value = aws_iam_policy.kms_sign.arn
}

output "kms_key_arns" {
  value = merge(
    { (var.PrimaryRegion) = aws_kms_key.primary.arn },
    { for region, replica in aws_kms_replica_key.replica : region => replica.arn }
  )
}

output "primary_key_id" {
  value = aws_kms_key.primary.key_id
}

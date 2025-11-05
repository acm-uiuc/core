data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  asset_bucket_prefix = "${data.aws_caller_identity.current.account_id}-${var.ProjectId}-assets"
}

module "buckets" {
  source       = "git::https://github.com/acm-uiuc/terraform-modules.git//multiregion-s3?ref=v2.0.0"
  Region1      = var.PrimaryRegion
  Region2      = var.SecondaryRegion
  BucketPrefix = local.asset_bucket_prefix
}

resource "aws_s3_bucket_lifecycle_configuration" "expire_noncurrent" {
  for_each = module.buckets.buckets_info
  region   = each.key
  bucket   = each.value.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 3
    }
  }

  rule {
    id     = "expire-delete-markers"
    status = "Enabled"

    expiration {
      expired_object_delete_marker = true
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 3
    }
  }
}

resource "aws_s3_bucket_intelligent_tiering_configuration" "tiering" {
  for_each = module.buckets.buckets_info
  bucket   = each.value.id
  region   = each.key
  name     = "EntireBucketIntelligentTiering"

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }
}

resource "aws_s3_bucket_cors_configuration" "ui_uploads" {
  for_each = module.buckets.buckets_info
  bucket   = each.value.id
  region   = each.key
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT"]
    allowed_origins = var.BucketAllowedCorsOrigins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "bucket_access" {
  statement {
    sid    = "AllowPutGetObjects"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:HeadObject"
    ]
    resources = [
      for bucket_info in module.buckets.buckets_info : "${bucket_info.arn}/*"
    ]
  }

  statement {
    sid    = "AllowListBucket"
    effect = "Allow"
    actions = [
      "s3:ListBucket"
    ]
    resources = [
      for bucket_info in module.buckets.buckets_info : bucket_info.arn
    ]
  }
}

resource "aws_iam_policy" "bucket_access" {
  name        = "${var.ProjectId}-bucket-access"
  description = "Policy to allow operations on ${local.asset_bucket_prefix} buckets"
  policy      = data.aws_iam_policy_document.bucket_access.json
}

output "access_policy_arn" {
  description = "ARN of the IAM policy for bucket access"
  value       = aws_iam_policy.bucket_access.arn
}

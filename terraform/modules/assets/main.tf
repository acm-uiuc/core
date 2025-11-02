data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  asset_bucket_prefix = "${data.aws_caller_identity.current.account_id}-${var.ProjectId}"
}

module "buckets" {
  source       = "git::https://github.com/acm-uiuc/terraform-modules.git//multiregion-s3?ref=99de4c350d1e35931f94499e0c06cbf29d0d5b8a"
  Region1      = var.PrimaryRegion
  Region2      = var.SecondaryRegion
  BucketPrefix = local.asset_bucket_prefix
}

resource "aws_s3_bucket_lifecycle_configuration" "expire_noncurrent" {
  for_each = module.buckets.buckets_info
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

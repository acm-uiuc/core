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

# --- CloudFront Origin Access Control ---
resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.ProjectId}-s3-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# --- CloudFront Distribution ---
locals {
  primary_origin_id   = "primary-s3"
  secondary_origin_id = "secondary-s3"
  origin_group_id     = "s3-failover-group"

  primary_bucket_domain   = "${module.buckets.buckets_info[var.PrimaryRegion].id}.s3.${var.PrimaryRegion}.amazonaws.com"
  secondary_bucket_domain = "${module.buckets.buckets_info[var.SecondaryRegion].id}.s3.${var.SecondaryRegion}.amazonaws.com"
}

resource "aws_cloudfront_distribution" "assets" {
  enabled     = true
  comment     = "${var.ProjectId} public asset distribution"
  price_class = "PriceClass_100"
  aliases     = [var.CoreAssetsPublicDomain]

  origin {
    domain_name              = local.primary_bucket_domain
    origin_id                = local.primary_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    domain_name              = local.secondary_bucket_domain
    origin_id                = local.secondary_origin_id
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin_group {
    origin_id = local.origin_group_id

    failover_criteria {
      status_codes = [500, 502, 503, 504]
    }

    member {
      origin_id = local.primary_origin_id
    }

    member {
      origin_id = local.secondary_origin_id
    }
  }

  # Serve /public/* from S3 via the failover origin group
  ordered_cache_behavior {
    path_pattern           = "/public/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.origin_group_id
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # Default behavior: deny everything else
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.primary_origin_id
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.CoreCertificateArn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
}

# --- Bucket policies: allow CloudFront to read /public/* only ---
data "aws_iam_policy_document" "cloudfront_read" {
  for_each = module.buckets.buckets_info

  statement {
    sid    = "AllowCloudFrontReadPublic"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${each.value.arn}/public/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.assets.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudfront_read" {
  for_each = module.buckets.buckets_info
  bucket   = each.value.id
  policy   = data.aws_iam_policy_document.cloudfront_read[each.key].json
}

output "access_policy_arn" {
  description = "ARN of the IAM policy for bucket access"
  value       = aws_iam_policy.bucket_access.arn
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.assets.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.assets.domain_name
}

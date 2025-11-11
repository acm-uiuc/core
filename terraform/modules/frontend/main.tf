locals {
  all_regions = keys(var.CoreHiCpuLambdaHost)
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "frontend" {
  region   = each.key
  for_each = toset(local.all_regions)
  bucket   = "${data.aws_caller_identity.current.account_id}-${var.ProjectId}-${each.key}"
}

resource "aws_s3_bucket_lifecycle_configuration" "frontend" {
  for_each = toset(local.all_regions)
  region   = each.key
  bucket   = aws_s3_bucket.frontend[each.key].id

  rule {
    id     = "AbortIncompleteMultipartUploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "ObjectLifecycle"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "INTELLIGENT_TIERING"
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_expiration {
      noncurrent_days = 60
    }
  }
}

data "archive_file" "ui" {
  type        = "zip"
  source_dir  = "${path.module}/../../../dist_ui/"
  output_path = "/tmp/ui_archive.zip"
}

resource "null_resource" "upload_frontend" {
  for_each = toset(local.all_regions)

  triggers = {
    ui_bucket_sha = data.archive_file.ui.output_sha
  }

  provisioner "local-exec" {
    command = "aws s3 sync ${data.archive_file.ui.source_dir} s3://${aws_s3_bucket.frontend[each.key].id} --region ${each.key} --delete"
  }
}

resource "null_resource" "invalidate_frontend" {
  depends_on = [null_resource.upload_frontend]
  triggers = {
    ui_bucket_sha = data.archive_file.ui.output_sha
  }

  provisioner "local-exec" {
    command     = <<-EOT
      set -e
      INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.app_cloudfront_distribution.id} --paths "/*" --query 'Invalidation.Id' --output text)
      aws cloudfront wait invalidation-completed --distribution-id ${aws_cloudfront_distribution.app_cloudfront_distribution.id} --id "$INVALIDATION_ID"
    EOT
    interpreter = ["bash", "-c"]
  }
}


resource "aws_cloudfront_origin_access_control" "frontend_oac" {
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
  name                              = "${var.ProjectId}-ui-oac"
}

resource "aws_cloudfront_cache_policy" "headers_no_cookies" {
  name        = "${var.ProjectId}-origin-cache-policy"
  default_ttl = 0
  max_ttl     = 31536000
  min_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["x-method-override", "origin", "x-http-method", "x-http-method-override"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    cookies_config {
      cookie_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "no_cache" {
  name        = "${var.ProjectId}-disable-cache-policy"
  default_ttl = 0
  max_ttl     = 31536000
  min_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
  }
}

resource "aws_cloudfront_distribution" "app_cloudfront_distribution" {
  http_version = "http2and3"

  # Dynamic origins for each region's S3 bucket
  dynamic "origin" {
    for_each = local.all_regions
    content {
      origin_id                = "S3Bucket-${origin.value}"
      origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac.id
      domain_name              = aws_s3_bucket.frontend[origin.value].bucket_regional_domain_name
    }
  }

  # Origin group for S3 buckets with failover
  origin_group {
    origin_id = "S3BucketGroup"

    failover_criteria {
      status_codes = [403, 404, 500, 502, 503, 504]
    }

    member {
      origin_id = "S3Bucket-${var.CurrentActiveRegion}"
    }

    dynamic "member" {
      for_each = [for region in local.all_regions : region if region != var.CurrentActiveRegion]
      content {
        origin_id = "S3Bucket-${member.value}"
      }
    }
  }

  # Dynamic origins for each region's Lambda function
  dynamic "origin" {
    for_each = var.CoreLambdaHost
    content {
      origin_id   = "LambdaFunction-${origin.key}"
      domain_name = origin.value
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      }
    }
  }

  # Dynamic origins for each region's HiCpu Lambda function
  dynamic "origin" {
    for_each = var.CoreHiCpuLambdaHost
    content {
      origin_id   = "HiCpuLambdaFunction-${origin.key}"
      domain_name = origin.value
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      }
    }
  }
  default_root_object = "index.html"
  aliases             = [var.CorePublicDomain]
  enabled             = true
  is_ipv6_enabled     = true
  default_cache_behavior {
    compress               = true
    target_origin_id       = "S3BucketGroup"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # caching-optimized
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.core_frontend_redirect.arn
    }
  }
  viewer_certificate {
    acm_certificate_arn      = var.CoreCertificateArn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  ordered_cache_behavior {
    path_pattern             = "/api/v1/syncIdentity"
    target_origin_id         = "HiCpuLambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  ordered_cache_behavior {
    path_pattern             = "/api/v1/users/findUserByUin"
    target_origin_id         = "HiCpuLambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  ordered_cache_behavior {
    path_pattern             = "/api/v1/tickets/getPurchasesByUser"
    target_origin_id         = "HiCpuLambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  ordered_cache_behavior {
    path_pattern             = "/api/v1/events*"
    target_origin_id         = "LambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.headers_no_cookies.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  ordered_cache_behavior {
    path_pattern             = "/api/v1/organizations*"
    target_origin_id         = "LambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.headers_no_cookies.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "LambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  price_class = "PriceClass_100"
}

resource "aws_cloudfront_distribution" "ical_cloudfront_distribution" {
  http_version = "http2and3"

  # Dynamic origins for each region's Lambda function
  dynamic "origin" {
    for_each = var.CoreLambdaHost
    content {
      origin_id   = "LambdaFunction-${origin.key}"
      domain_name = origin.value
      origin_path = "/api/v1/ical"
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1", "TLSv1.1", "TLSv1.2"]
      }
    }
  }
  aliases         = [var.IcalPublicDomain]
  enabled         = true
  is_ipv6_enabled = true
  default_cache_behavior {
    compress                 = true
    target_origin_id         = "LambdaFunction-${var.CurrentActiveRegion}"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.headers_no_cookies.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.origin_key_injection.arn
    }
  }
  viewer_certificate {
    acm_certificate_arn      = var.CoreCertificateArn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  price_class = "PriceClass_100"
}

resource "aws_cloudfront_function" "origin_key_injection" {
  name    = "${var.ProjectId}-origin-verification-injection"
  comment = "Injects origin verification key into requests"
  runtime = "cloudfront-js-2.0"
  code    = <<EOT
function handler(event) {
    var request = event.request;
    request.headers['x-origin-verify'] = { value: "${var.OriginVerifyKey}" };
    return request;
}
EOT
}

resource "aws_cloudfront_function" "core_frontend_redirect" {
  name    = "${var.ProjectId}-spa-rewrite"
  comment = "Handles SPA routing by rewriting URIs to index.html"
  runtime = "cloudfront-js-2.0"
  code    = <<EOT
function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Rewrite /docs or /docs/ to the documentation index file
    if (uri === '/docs' || uri === '/docs/') {
        request.uri = '/docs/index.html';
        return request;
    }

    // If the URI starts with /api/ and has a trailing slash, or includes a dot (is a file),
    // let it pass through without modification.
    // This ensures paths like /api/v1/data or /some/image.png are not rewritten.
    if (uri.startsWith('/api/') || uri.includes('.')) {
        return request;
    }

    // Rewrite and all other non-file paths to index.html for the SPA.
    request.uri = '/index.html';
    return request;
}
EOT
}

resource "null_resource" "s3_bucket_policy" {
  for_each = toset(local.all_regions)

  triggers = {
    bucket_id        = aws_s3_bucket.frontend[each.key].id
    distribution_arn = aws_cloudfront_distribution.app_cloudfront_distribution.arn
    policy_hash = md5(jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect = "Allow",
          Principal = {
            Service = "cloudfront.amazonaws.com"
          },
          Action   = "s3:GetObject",
          Resource = "${aws_s3_bucket.frontend[each.key].arn}/*"
          Condition = {
            StringEquals = {
              "AWS:SourceArn" = aws_cloudfront_distribution.app_cloudfront_distribution.arn
            }
          }
        },
        {
          Effect = "Allow",
          Principal = {
            Service = "cloudfront.amazonaws.com"
          },
          Action   = "s3:ListBucket",
          Resource = aws_s3_bucket.frontend[each.key].arn
          Condition = {
            StringEquals = {
              "AWS:SourceArn" = aws_cloudfront_distribution.app_cloudfront_distribution.arn
            }
          }
        }
      ]
    }))
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put-bucket-policy \
        --bucket ${aws_s3_bucket.frontend[each.key].id} \
        --region ${each.key} \
        --policy '{
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Principal": {
                "Service": "cloudfront.amazonaws.com"
              },
              "Action": "s3:GetObject",
              "Resource": "${aws_s3_bucket.frontend[each.key].arn}/*",
              "Condition": {
                "StringEquals": {
                  "AWS:SourceArn": "${aws_cloudfront_distribution.app_cloudfront_distribution.arn}"
                }
              }
            },
            {
              "Effect": "Allow",
              "Principal": {
                "Service": "cloudfront.amazonaws.com"
              },
              "Action": "s3:ListBucket",
              "Resource": "${aws_s3_bucket.frontend[each.key].arn}",
              "Condition": {
                "StringEquals": {
                  "AWS:SourceArn": "${aws_cloudfront_distribution.app_cloudfront_distribution.arn}"
                }
              }
            }
          ]
        }'
    EOT
  }
}

resource "aws_cloudfront_distribution" "linkry_cloudfront_distribution" {
  http_version = "http2and3"
  origin {
    origin_id   = "DummyOrigin"
    domain_name = "example.com"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1", "TLSv1.1", "TLSv1.2"]
    }
  }
  aliases = concat(
    var.LinkryPublicDomains,
    [for domain in var.LinkryPublicDomains : "*.${domain}"]
  )
  enabled         = true
  is_ipv6_enabled = true
  default_cache_behavior {
    compress               = true
    target_origin_id       = "DummyOrigin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "83da9c7e-98b4-4e11-a168-04f0df8e2c65"
    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = var.LinkryEdgeFunctionArn
      include_body = false
    }
  }
  viewer_certificate {
    acm_certificate_arn      = var.LinkryCertificateArn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  price_class = "PriceClass_100"
}

output "main_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.app_cloudfront_distribution.id
}

output "main_cloudfront_domain_name" {
  value = aws_cloudfront_distribution.app_cloudfront_distribution.domain_name
}

output "ical_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.ical_cloudfront_distribution.id
}

output "ical_cloudfront_domain_name" {
  value = aws_cloudfront_distribution.ical_cloudfront_distribution.domain_name
}

output "linkry_cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.linkry_cloudfront_distribution.id
}

output "linkry_cloudfront_domain_name" {
  value = aws_cloudfront_distribution.linkry_cloudfront_distribution.domain_name
}

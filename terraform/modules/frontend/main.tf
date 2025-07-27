resource "aws_s3_bucket" "frontend" {
  bucket = "${var.BucketPrefix}-${var.ProjectId}"
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
  origin {
    origin_id                = "S3Bucket"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac.id
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
  }
  origin {
    origin_id   = "LambdaFunction"
    domain_name = var.CoreLambdaHost
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1", "TLSv1.1", "TLSv1.2"]
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = var.OriginVerifyKey
    }
  }
  default_root_object = "index.html"
  aliases             = [var.CorePublicDomain]
  enabled             = true
  is_ipv6_enabled     = true
  default_cache_behavior {
    compress               = true
    target_origin_id       = "S3Bucket"
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
    path_pattern             = "/api/v1/events*"
    target_origin_id         = "LambdaFunction"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.headers_no_cookies.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
  }
  ordered_cache_behavior {
    path_pattern             = "/api/v1/organizations"
    target_origin_id         = "LambdaFunction"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
  }
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "LambdaFunction"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
  }
  price_class = "PriceClass_100"
}

resource "aws_cloudfront_distribution" "ical_cloudfront_distribution" {
  http_version = "http2and3"
  origin {
    origin_id   = "LambdaFunction"
    domain_name = var.CoreLambdaHost
    origin_path = "/api/v1/ical"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1", "TLSv1.1", "TLSv1.2"]
    }
    custom_header {
      name  = "X-Origin-Verify"
      value = var.OriginVerifyKey
    }
  }
  aliases         = [var.IcalPublicDomain]
  enabled         = true
  is_ipv6_enabled = true
  default_cache_behavior {
    compress                 = true
    target_origin_id         = "LambdaFunction"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.headers_no_cookies.id
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
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

resource "aws_cloudfront_function" "linkry_redirect" {
  name                         = "${var.ProjectId}-linkry-edge-redir"
  comment                      = "Linkry Redirect @ Edge"
  key_value_store_associations = [var.LinkryKvArn]
  runtime                      = "cloudfront-js-2.0"
  code                         = <<EOT
import cf from 'cloudfront';
const kvs = cf.kvs();

async function handler(event) {
  const request = event.request;
  const path = request.uri.replace(/^\/+/, '');
  if (path === "") {
    return {
      statusCode: 301,
      statusDescription: 'Found',
      headers: {
        'location': { value: "https://${var.CorePublicDomain}/linkry" }
      }
    }
  }
  let redirectUrl = "https://acm.illinois.edu/404";
  try {
    const value = await kvs.get(path);
    if (value) {
      redirectUrl = value;
    }
  } catch (err) {
    console.log(`KVS key lookup failed for $!{path}: $!{err}`);
  }
  var response = {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      'location': { value: redirectUrl }
    }
  };
  return response;
}
EOT
}
resource "aws_s3_bucket_policy" "frontend_bucket_policy" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode(({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "cloudfront.amazonaws.com"
        },
        Action   = "s3:GetObject",
        Resource = "${aws_s3_bucket.frontend.arn}/*"
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
        Resource = aws_s3_bucket.frontend.arn
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.app_cloudfront_distribution.arn
          }
        }
      }
    ]

  }))

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
  aliases         = [var.LinkryPublicDomain]
  enabled         = true
  is_ipv6_enabled = true
  default_cache_behavior {
    compress               = true
    target_origin_id       = "DummyOrigin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.linkry_redirect.arn
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

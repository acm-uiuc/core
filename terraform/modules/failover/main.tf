locals {
  lambda_url_zone_ids = {
    us-east-1 = "Z3DZXE0Q79N41H"
    us-east-2 = "Z2OU6JVYJXRXFB"
    us-west-1 = "Z2LSA7GYHVR9KC"
    us-west-2 = "Z1UJRXOUMOOFQ8"
  }

  secondary_list = flatten([
    for key, cfg in var.configs : [
      for idx, url in slice(tolist(cfg.url), 1, length(cfg.url)) : {
        record_name = key
        target_url  = url
        unique_id   = "${key}-secondary-${idx}"
        region      = regex("lambda-url\\.([a-z0-9-]+)\\.on\\.aws", url)[0]
      }
    ]
  ])
}

resource "aws_route53_health_check" "endpoint_advanced" {
  for_each = var.configs

  fqdn              = tolist(each.value.url)[0]
  port              = 443
  type              = "HTTPS"
  resource_path     = each.value.healthcheckEndpoint
  failure_threshold = 3
  request_interval  = 30
  measure_latency   = true
  enable_sni        = true
  search_string     = "UP"

  tags = {
    Name = "${each.key}-primary-hc"
  }
}

# Primary Records
resource "aws_route53_record" "primary" {
  for_each = var.configs

  zone_id = var.route53_zone
  name    = each.key
  type    = "A"

  alias {
    name                   = tolist(each.value.url)[0]
    zone_id                = local.lambda_url_zone_ids[regex("lambda-url\\.([a-z0-9-]+)\\.on\\.aws", tolist(each.value.url)[0])[0]]
    evaluate_target_health = true
  }

  failover_routing_policy {
    type = "PRIMARY"
  }

  set_identifier  = "${each.key}-primary"
  health_check_id = aws_route53_health_check.endpoint_advanced[each.key].id
}

# Secondary Records
resource "aws_route53_record" "secondary" {
  for_each = {
    for item in local.secondary_list : item.unique_id => item
  }

  zone_id = var.route53_zone
  name    = each.value.record_name
  type    = "A"

  alias {
    name                   = each.value.target_url
    zone_id                = local.lambda_url_zone_ids[each.value.region]
    evaluate_target_health = true
  }

  failover_routing_policy {
    type = "SECONDARY"
  }

  set_identifier = each.key
}

locals {
  # Flatten the map to create a list of secondary objects (index 1 and beyond)
  secondary_list = flatten([
    for key, cfg in var.configs : [
      for idx, url in slice(tolist(cfg.url), 1, length(cfg.url)) : {
        record_name = key
        target_url  = replace(url, "/^https?:\\/\\//", "")
        # Unique identifier for the set
        unique_id = "${key}-secondary-${idx}"
      }
    ]
  ])
}

resource "aws_route53_health_check" "endpoint_advanced" {
  for_each = var.configs

  fqdn              = replace(tolist(each.value.url)[0], "/^https?:\\/\\//", "")
  port              = 443
  type              = "HTTPS"
  resource_path     = each.value.healthcheckEndpoint
  failure_threshold = 3
  request_interval  = 30
  measure_latency   = true
  enable_sni        = true
  search_string     = "OK"

  tags = {
    Name = "${each.key}-primary-hc"
  }
}


# Primary Records
resource "aws_route53_record" "primary" {
  for_each = var.configs

  zone_id = var.route53_zone
  name    = each.key
  type    = "CNAME"

  alias {
    name                   = replace(tolist(each.value.url)[0], "/^https?:\\/\\//", "")
    zone_id                = var.route53_zone
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
  type    = "CNAME"

  alias {
    name                   = each.value.target_url
    zone_id                = var.route53_zone
    evaluate_target_health = true
  }

  failover_routing_policy {
    type = "SECONDARY"
  }

  set_identifier = each.key
}

variable "route53_zone" {
  type        = string
  description = "Route 53 zone which API backend maps to for failover health checks"
}

variable "configs" {
  description = "Map of groups to lists of configs"
  type = map(object({
    url                 = set(string)
    healthcheckEndpoint = string
  }))
}

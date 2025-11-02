variable "PrimaryRegion" {
  type    = string
  default = "us-east-2"
}

variable "SecondaryRegion" {
  type    = string
  default = "us-west-2"
}

variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "BucketAllowedCorsOrigins" {
  type        = list(string)
  description = "List of URLs that bucket can be read/written from."
}

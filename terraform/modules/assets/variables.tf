variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "BucketPrefix" {
  type = string
}

variable "CoreCertificateArn" {
  type        = string
  description = "Core ACM ARN"
}

variable "AssetsPublicDomain" {
  type        = string
  description = "Core Assets Public Host"
}

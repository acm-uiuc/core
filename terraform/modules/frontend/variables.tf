variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "CoreLambdaHost" {
  type        = map(string)
  description = "Map of region to Lambda Function URL host"
}


variable "CurrentActiveRegion" {
  type        = string
  description = "Currently active AWS region for primary routing"
}

variable "CorePublicDomain" {
  type        = string
  description = "Core Public Host"
}

variable "IcalPublicDomain" {
  type        = string
  description = "Ical Public Host"
}

variable "LinkryPublicDomains" {
  type        = set(string)
  description = "Linky Public Hosts"
}


variable "CoreCertificateArn" {
  type        = string
  description = "Core ACM ARN"
}

variable "LinkryCertificateArn" {
  type        = string
  description = "Linkry ACM ARN"
}

variable "BucketPrefix" {
  type = string
}

variable "OriginVerifyKey" {
  type = string
}

variable "LinkryEdgeFunctionArn" {
  type = string
}

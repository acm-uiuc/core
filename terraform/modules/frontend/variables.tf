variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "CoreLambdaHost" {
  type        = map(string)
  description = "Map of region to Lambda Function URL host"
}

variable "CoreSlowLambdaHost" {
  type        = map(string)
  description = "Map of region to Slow Lambda Function URL host"
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

variable "LinkryPublicDomain" {
  type        = string
  description = "Ical Public Host"
}


variable "CoreCertificateArn" {
  type        = string
  description = "Core ACM ARN"
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

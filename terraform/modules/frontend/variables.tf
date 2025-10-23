variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "CoreLambdaHost" {
  type        = string
  description = "Host for Lambda Function URL"
}

variable "CoreSlowLambdaHost" {
  type        = string
  description = "Host for Slow Lambda Function URL"
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

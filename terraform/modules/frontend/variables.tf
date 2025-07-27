variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "CoreLambdaHost" {
  type        = string
  description = "Host for Lambda Function URL"
}

variable "CorePublicDomain" {
  type        = string
  description = "Core Public Host"
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

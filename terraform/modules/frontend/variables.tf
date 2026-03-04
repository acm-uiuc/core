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

variable "InvoicePaymentPublicDomain" {
  type        = string
  description = "Invoice payment public URL domain"

}

variable "InvoicePaymentCertificate" {
  type        = string
  description = "Invoice payment public URL domain certificate"

}


variable "LinkryPublicDomains" {
  type        = set(string)
  description = "Linky Public Hosts"
}
variable "CoreCertificateArn" {
  type        = string
  description = "Core ACM ARN"
}

variable "InvoicePaymentPublicDomain" {
  type        = string
  description = "Public domain for hosted invoice payment pages (e.g. pay.acm.illinois.edu)"
}
// ^ use this new vairable called InvoicePaymentPublicDomain, pass into environments, then write cloudfront distribution

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

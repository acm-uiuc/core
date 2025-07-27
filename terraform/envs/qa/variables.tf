variable "LogRetentionDays" {
  type    = number
  default = 7
}

variable "ProjectId" {
  type    = string
  default = "infra-core-api"
}

variable "CoreCertificateArn" {
  type    = string
  default = "arn:aws:acm:us-east-1:427040638965:certificate/63ccdf0b-d2b5-44f0-b589-eceffb935c23"
}

variable "CorePublicDomain" {
  type    = string
  default = "core-tf.aws.qa.acmuiuc.org"
}

variable "LinkryPublicDomain" {
  type    = string
  default = "go-tf.aws.qa.acmuiuc.org"
}

variable "IcalPublicDomain" {
  type    = string
  default = "ical-tf.aws.qa.acmuiuc.org"
}

variable "EmailDomain" {
  type    = string
  default = "aws.qa.acmuiuc.org"
}

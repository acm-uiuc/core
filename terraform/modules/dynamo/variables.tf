variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "ReplicationRegions" {
  type        = set(string)
  description = "A list of regions where data should be replicated to (in addition to the primary region)"
}

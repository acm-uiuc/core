variable "ProjectId" {
  type        = string
  description = "Prefix before each resource"
}

variable "LinkryReplicationRegions" {
  type        = set(string)
  description = "A list of regions where the Linkry data should be replicated to (in addition to the primary region)"
}

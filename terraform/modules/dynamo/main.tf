resource "aws_dynamodb_table" "app_audit_log" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-audit-log"
  deletion_protection_enabled = true
  hash_key                    = "module"
  range_key                   = "createdAt"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "module"
    type = "S"
  }
  attribute {
    name = "createdAt"
    type = "N"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "membership_provisioning_log" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-membership-provisioning"
  deletion_protection_enabled = true
  hash_key                    = "email"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "email"
    type = "S"
  }
}


resource "aws_dynamodb_table" "api_keys" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-keys"
  deletion_protection_enabled = true
  hash_key                    = "keyId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "keyId"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "room_requests" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-room-requests"
  deletion_protection_enabled = true
  hash_key                    = "semesterId"
  range_key                   = "userId#requestId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userId#requestId"
    type = "S"
  }
  attribute {
    name = "requestId"
    type = "S"
  }
  attribute {
    name = "semesterId"
    type = "S"
  }
  global_secondary_index {
    name            = "RequestIdIndex"
    hash_key        = "requestId"
    projection_type = "ALL"
  }
}


resource "aws_dynamodb_table" "room_requests_status" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-room-requests-status"
  deletion_protection_enabled = true
  hash_key                    = "requestId"
  range_key                   = "createdAt#status"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "createdAt#status"
    type = "S"
  }
  attribute {
    name = "requestId"
    type = "S"
  }
  attribute {
    name = "semesterId"
    type = "S"
  }
  global_secondary_index {
    name            = "SemesterId"
    hash_key        = "semesterId"
    range_key       = "requestId"
    projection_type = "ALL"
  }
}


resource "aws_dynamodb_table" "external_membership" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-membership-external-v3"
  deletion_protection_enabled = true
  hash_key                    = "memberList"
  range_key                   = "netId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "netId"
    type = "S"
  }

  attribute {
    name = "memberList"
    type = "S"
  }

  global_secondary_index {
    name            = "invertedIndex"
    hash_key        = "netId"
    range_key       = "memberList"
    projection_type = "KEYS_ONLY"
  }


  global_secondary_index {
    name            = "keysOnlyIndex"
    hash_key        = "memberList"
    projection_type = "KEYS_ONLY"
  }

}

resource "aws_dynamodb_table" "iam_group_roles" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-iam-grouproles"
  deletion_protection_enabled = true
  hash_key                    = "groupUuid"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "groupUuid"
    type = "S"
  }
}

resource "aws_dynamodb_table" "iam_user_roles" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-iam-userroles"
  deletion_protection_enabled = true
  hash_key                    = "userEmail"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userEmail"
    type = "S"
  }
}


resource "aws_dynamodb_table" "events" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-events"
  deletion_protection_enabled = true
  hash_key                    = "id"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "host"
    type = "S"
  }
  global_secondary_index {
    name            = "HostIndex"
    hash_key        = "host"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "stripe_links" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-stripe-links"
  deletion_protection_enabled = true
  hash_key                    = "userId"
  range_key                   = "linkId"

  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "linkId"
    type = "S"
  }
  global_secondary_index {
    name            = "LinkIdIndex"
    hash_key        = "linkId"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "linkry_records" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-linkry"
  deletion_protection_enabled = true
  hash_key                    = "slug"
  range_key                   = "access"

  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "slug"
    type = "S"
  }
  attribute {
    name = "access"
    type = "S"
  }

  global_secondary_index {
    name            = "AccessIndex"
    hash_key        = "access"
    range_key       = "slug"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "cache" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-cache"
  deletion_protection_enabled = true
  hash_key                    = "primaryKey"
  point_in_time_recovery {
    enabled = false
  }
  attribute {
    name = "primaryKey"
    type = "S"
  }
  ttl {
    attribute_name = "expireAt"
    enabled        = true
  }
}

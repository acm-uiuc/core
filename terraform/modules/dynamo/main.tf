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
    attribute_name = "expireAt"
    enabled        = true
  }
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
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
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
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
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
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


resource "aws_dynamodb_table" "iam_assignments" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-iam-assignments"
  deletion_protection_enabled = true
  hash_key                    = "id"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "user_info" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-user-info"
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
    name = "uinHash"
    type = "S"
  }
  global_secondary_index {
    name            = "UinHashIndex"
    hash_key        = "uinHash"
    projection_type = "KEYS_ONLY"
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
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"
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
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "stripe_payments" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-stripe-payments"
  deletion_protection_enabled = true
  hash_key                    = "primaryKey"
  range_key                   = "sortKey"

  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "primaryKey"
    type = "S"
  }

  attribute {
    name = "sortKey"
    type = "S"
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

resource "aws_dynamodb_table" "sig_info" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-sigs"
  deletion_protection_enabled = true
  hash_key                    = "primaryKey"
  range_key                   = "entryId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "primaryKey"
    type = "S"
  }
  attribute {
    name = "entryId"
    type = "S"
  }
  attribute {
    name = "leadsEntraGroupId"
    type = "S"
  }
  attribute {
    name = "username"
    type = "S"
  }
  global_secondary_index {
    name            = "UsernameIndex"
    hash_key        = "username"
    range_key       = "primaryKey"
    projection_type = "KEYS_ONLY"
  }
  global_secondary_index {
    name            = "LeadsGroupIdIndex"
    hash_key        = "leadsEntraGroupId"
    range_key       = "primaryKey"
    projection_type = "KEYS_ONLY"
  }
}

resource "aws_dynamodb_table" "store_inventory" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-store-inventory"
  deletion_protection_enabled = true
  hash_key                    = "productId"
  range_key                   = "variantId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "productId"
    type = "S"
  }
  attribute {
    name = "variantId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "store_carts_orders" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-store-carts-orders"
  deletion_protection_enabled = true
  hash_key                    = "orderId"
  range_key                   = "lineItemId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "orderId"
    type = "S"
  }
  attribute {
    name = "lineItemId"
    type = "S"
  }
  attribute {
    name = "itemId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }
  global_secondary_index {
    name            = "ItemIdIndex"
    hash_key        = "itemId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "store_limits" {
  billing_mode                = "PAY_PER_REQUEST"
  name                        = "${var.ProjectId}-store-limits"
  deletion_protection_enabled = true
  hash_key                    = "userId"
  range_key                   = "limitId"
  point_in_time_recovery {
    enabled = true
  }
  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "limitId"
    type = "S"
  }
}

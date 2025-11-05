data "archive_file" "api_lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../dist/lambda"
  output_path = "${path.module}/../../../dist/terraform/api.zip"
}

data "archive_file" "sqs_lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../dist/sqsConsumer"
  output_path = "${path.module}/../../../dist/terraform/sqs.zip"
}

data "archive_file" "linkry_edge_lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../src/linkryEdgeFunction/"
  output_path = "${path.module}/../../../dist/terraform/linkryEdgeFunction.zip"
}

locals {
  core_api_lambda_name          = "${var.ProjectId}-main-server"
  core_api_hicpu_lambda_name    = "${var.ProjectId}-hicpu-server"
  core_sqs_consumer_lambda_name = "${var.ProjectId}-sqs-consumer"
  entra_policies = {
    shared = aws_iam_policy.shared_iam_policy.arn
    entra  = aws_iam_policy.entra_policy.arn
  }
  sqs_policies = {
    sqs     = aws_iam_policy.sqs_policy.arn
    shared  = aws_iam_policy.shared_iam_policy.arn
    managed = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
  }
  api_policies = {
    api    = aws_iam_policy.api_only_policy.arn
    shared = aws_iam_policy.shared_iam_policy.arn
  }
  is_primary_deployment = var.region == "us-east-2"
}
data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_group" "api_logs" {
  region            = var.region
  name              = "/aws/lambda/${local.core_api_lambda_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_iam_role" "api_role" {
  name_prefix = "${local.core_api_lambda_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        },
      },
    ]
  })
}

resource "aws_iam_role" "sqs_consumer_role" {
  name_prefix = "${local.core_sqs_consumer_lambda_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role" "entra_role" {
  name_prefix = "${var.ProjectId}-entra-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = "AllowApiRole"
        Principal = {
          AWS = aws_iam_role.api_role.arn
        }
      },
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = "AllowConsumerRole"
        Principal = {
          AWS = aws_iam_role.sqs_consumer_role.arn
        }
      },
    ]
  })
}

resource "aws_iam_policy" "entra_policy" {
  name_prefix = "${var.ProjectId}-entra-policy"
  policy = jsonencode(({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow",
        Action = ["secretsmanager:GetSecretValue"],
        Resource = [
          "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-entra*",
          "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-ro-entra*"
        ]
      }
    ]
  }))
}

resource "aws_iam_policy" "api_only_policy" {
  name_prefix = "${var.ProjectId}-api-only-policy"
  policy = jsonencode(({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow",
        Action = ["sqs:SendMessage"],
        Resource = [
          "arn:aws:sqs:${var.region}:${data.aws_caller_identity.current.account_id}:${var.ProjectId}-*",
        ]
      }
    ]
  }))
}

resource "aws_iam_policy" "sqs_policy" {
  name_prefix = "${var.ProjectId}-sqs-consumer-policy"
  policy = jsonencode(({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SendMembershipEmails",
        Effect   = "Allow",
        Action   = ["ses:SendEmail", "ses:SendRawEmail"],
        Resource = ["*"],
        Condition = {
          "StringEquals" = {
            "ses:FromAddress" = "membership@${var.EmailDomain}"
          },
          "ForAllValues:StringLike" = {
            "ses:Recipients" = ["*@illinois.edu"]
          }
        }
      },
      {
        Sid      = "SendNotificationEmails",
        Effect   = "Allow",
        Action   = ["ses:SendEmail", "ses:SendRawEmail"],
        Resource = ["*"],
        Condition = {
          "StringEquals" = {
            "ses:FromAddress" = "notifications@${var.EmailDomain}"
          },
        }
      },
      {
        Sid      = "SendSalesEmails",
        Effect   = "Allow",
        Action   = ["ses:SendEmail", "ses:SendRawEmail"],
        Resource = ["*"],
        Condition = {
          "StringEquals" = {
            "ses:FromAddress" = "sales@${var.EmailDomain}"
          },
        }
      }
    ]
  }))

}


resource "aws_iam_policy" "shared_iam_policy" {
  name_prefix = "${var.ProjectId}-lambda-shared-policy"
  policy = jsonencode(({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Effect   = "Allow",
        Resource = ["${aws_cloudwatch_log_group.api_logs.arn}:*"]
      },
      {
        Action = ["secretsmanager:GetSecretValue"],
        Effect = "Allow",
        Resource = [
          "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-config*",
          "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-testing-credentials*",
          "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-uin-pepper*"
        ]
      },
      {
        Action   = ["dynamodb:DescribeLimits"],
        Effect   = "Allow",
        Resource = ["*"]
      },
      {
        Sid = "DynamoDBTableAccess"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:PutItem",
          "dynamodb:DescribeTable",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ],
        Effect = "Allow",
        Resource = [
          // Tickets is still in us-east-1!
          "arn:aws:dynamodb:us-east-1:${data.aws_caller_identity.current.account_id}:table/infra-events-tickets",
          "arn:aws:dynamodb:us-east-1:${data.aws_caller_identity.current.account_id}:table/infra-events-tickets/index/*",
          "arn:aws:dynamodb:us-east-1:${data.aws_caller_identity.current.account_id}:table/infra-events-ticketing-metadata",
          "arn:aws:dynamodb:us-east-1:${data.aws_caller_identity.current.account_id}:table/infra-merchstore-purchase-history",
          "arn:aws:dynamodb:us-east-1:${data.aws_caller_identity.current.account_id}:table/infra-merchstore-purchase-history/index/*",
          "arn:aws:dynamodb:us-east-1:${data.aws_caller_identity.current.account_id}:table/infra-merchstore-metadata",

          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-events",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-events/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-iam-assignments",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-stripe-links",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-stripe-links/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-membership-external-v3",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-membership-external-v3/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests-status",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests-status/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-linkry",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-linkry/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-keys",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-sigs",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-sigs/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-store-inventory",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-store-carts-orders",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-store-carts-orders/index/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-store-limits"
        ]
      },
      {
        Sid    = "DynamoDBCacheAccess",
        Effect = "Allow",
        Action = [
          "dynamodb:ConditionCheckItem",
          "dynamodb:PutItem",
          "dynamodb:DescribeTable",
          "dynamodb:DeleteItem",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem"
        ],
        Resource = [
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-cache",
        ]
      },
      {
        Sid    = "DynamoDBAuditLogAccess",
        Effect = "Allow",
        Action = [
          "dynamodb:PutItem",
          "dynamodb:DescribeTable",
          "dynamodb:Query",
        ],
        Resource = [
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-audit-log",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-audit-log/index/*",
        ]
      },
      {
        Sid    = "DynamoDBUserInfoAccess",
        Effect = "Allow",
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:DescribeTable",
          "dynamodb:BatchGetItem",
          "dynamodb:Query",
        ],
        Resource = [
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-user-info",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-user-info/index/*",
        ]
      },
      {
        Sid    = "DynamoDBStreamAccess",
        Effect = "Allow",
        Action = [
          "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:ListStreams"
        ],
        Resource = [
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-stripe-links/stream/*",
          "arn:aws:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-events/stream/*",
        ]
      },
    ]
  }))

}

resource "aws_iam_role_policy_attachment" "api_attach" {
  for_each   = local.api_policies
  role       = aws_iam_role.api_role.name
  policy_arn = each.value
}

resource "aws_iam_role_policy_attachment" "api_attach_addl" {
  for_each   = var.AdditionalIamPolicies
  role       = aws_iam_role.api_role.name
  policy_arn = each.value
}

resource "aws_iam_role_policy_attachment" "entra_attach" {
  for_each   = local.entra_policies
  role       = aws_iam_role.entra_role.name
  policy_arn = each.value
}

resource "aws_iam_role_policy_attachment" "sqs_attach_shared" {
  for_each   = local.sqs_policies
  role       = aws_iam_role.sqs_consumer_role.name
  policy_arn = each.value
}

resource "aws_iam_role_policy_attachment" "sqs_attach_addl" {
  for_each   = var.AdditionalIamPolicies
  role       = aws_iam_role.sqs_consumer_role.name
  policy_arn = each.value
}

resource "aws_lambda_function" "api_lambda" {
  region           = var.region
  depends_on       = [aws_cloudwatch_log_group.api_logs]
  function_name    = local.core_api_lambda_name
  role             = aws_iam_role.api_role.arn
  architectures    = ["arm64"]
  handler          = "lambda.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.api_lambda_code.output_path
  timeout          = 15
  memory_size      = 2048
  source_code_hash = data.archive_file.api_lambda_code.output_sha256
  environment {
    variables = {
      "RunEnvironment"                      = var.RunEnvironment
      "AWS_CRT_NODEJS_BINARY_RELATIVE_PATH" = "node_modules/aws-crt/dist/bin/linux-arm64-glibc/aws-crt-nodejs.node"
      ORIGIN_VERIFY_KEY                     = var.CurrentOriginVerifyKey
      PREVIOUS_ORIGIN_VERIFY_KEY            = var.PreviousOriginVerifyKey
      PREVIOUS_ORIGIN_VERIFY_KEY_EXPIRES_AT = var.PreviousOriginVerifyKeyExpiresAt
      EntraRoleArn                          = aws_iam_role.entra_role.arn
      "NODE_OPTIONS"                        = "--enable-source-maps"
    }
  }
}

resource "aws_lambda_function" "sqs_lambda" {
  region     = var.region
  depends_on = [aws_cloudwatch_log_group.api_logs]
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api_logs.name
  }
  function_name    = local.core_sqs_consumer_lambda_name
  role             = aws_iam_role.sqs_consumer_role.arn
  architectures    = ["arm64"]
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.sqs_lambda_code.output_path
  timeout          = 300
  memory_size      = 2048
  source_code_hash = data.archive_file.sqs_lambda_code.output_sha256

  environment {
    variables = {
      "RunEnvironment"                      = var.RunEnvironment
      "AWS_CRT_NODEJS_BINARY_RELATIVE_PATH" = "node_modules/aws-crt/dist/bin/linux-arm64-glibc/aws-crt-nodejs.node"
      EntraRoleArn                          = aws_iam_role.entra_role.arn
      "NODE_OPTIONS"                        = "--enable-source-maps"
    }
  }
}

resource "aws_lambda_function_url" "api_lambda_function_url" {
  region             = var.region
  function_name      = aws_lambda_function.api_lambda.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

// hicpu lambda - used for monitoring purposes to avoid triggering lamdba latency alarms
resource "aws_lambda_function" "hicpu_lambda" {
  region           = var.region
  depends_on       = [aws_cloudwatch_log_group.api_logs]
  function_name    = local.core_api_hicpu_lambda_name
  role             = aws_iam_role.api_role.arn
  architectures    = ["arm64"]
  handler          = "lambda.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.api_lambda_code.output_path
  timeout          = 15
  memory_size      = 4096 // This will get us 2 full CPU cores, which will speed up those cryptographic ops that require this server
  source_code_hash = data.archive_file.api_lambda_code.output_sha256
  logging_config {
    log_group  = aws_cloudwatch_log_group.api_logs.name
    log_format = "Text"
  }
  environment {
    variables = {
      "RunEnvironment"                      = var.RunEnvironment
      "AWS_CRT_NODEJS_BINARY_RELATIVE_PATH" = "node_modules/aws-crt/dist/bin/linux-arm64-glibc/aws-crt-nodejs.node"
      ORIGIN_VERIFY_KEY                     = var.CurrentOriginVerifyKey
      PREVIOUS_ORIGIN_VERIFY_KEY            = var.PreviousOriginVerifyKey
      PREVIOUS_ORIGIN_VERIFY_KEY_EXPIRES_AT = var.PreviousOriginVerifyKeyExpiresAt
      EntraRoleArn                          = aws_iam_role.entra_role.arn
      "NODE_OPTIONS"                        = "--enable-source-maps"
    }
  }
}

resource "aws_lambda_function_url" "hicpu_api_lambda_function_url" {
  region             = var.region
  function_name      = aws_lambda_function.hicpu_lambda.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

module "lambda_warmer_main" {
  region              = var.region
  source              = "git::https://github.com/acm-uiuc/terraform-modules.git//lambda-warmer?ref=c1a2d3a474a719b0c1e46842e96056478e98c2c7"
  function_to_warm    = local.core_api_lambda_name
  is_streaming_lambda = true
}

module "lambda_warmer_hicpu" {
  region              = var.region
  source              = "git::https://github.com/acm-uiuc/terraform-modules.git//lambda-warmer?ref=c1a2d3a474a719b0c1e46842e96056478e98c2c7"
  function_to_warm    = local.core_api_hicpu_lambda_name
  is_streaming_lambda = true
}

// Linkry Lambda @ Edge
resource "aws_iam_role" "linkry_lambda_edge_role" {
  count       = local.is_primary_deployment ? 1 : 0
  name_prefix = "${var.ProjectId}-linkry-edge-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = [
            "lambda.amazonaws.com",
            "edgelambda.amazonaws.com"
          ]
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "linkry_lambda_edge_basic" {
  count      = local.is_primary_deployment ? 1 : 0
  role       = aws_iam_role.linkry_lambda_edge_role[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "linkry_lambda_edge_dynamodb" {
  count       = local.is_primary_deployment ? 1 : 0
  name_prefix = "${var.ProjectId}-linkry-edge-dynamodb"
  role        = aws_iam_role.linkry_lambda_edge_role[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [
          "arn:aws:dynamodb:*:${data.aws_caller_identity.current.account_id}:table/${var.ProjectId}-linkry"
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "linkry_edge" {
  count            = local.is_primary_deployment ? 1 : 0
  region           = "us-east-1"
  filename         = data.archive_file.linkry_edge_lambda_code.output_path
  function_name    = "${var.ProjectId}-linkry-edge"
  role             = aws_iam_role.linkry_lambda_edge_role[0].arn
  handler          = "main.handler"
  runtime          = "python3.12"
  publish          = true
  timeout          = 5
  memory_size      = 128
  source_code_hash = data.archive_file.linkry_edge_lambda_code.output_base64sha256
}

// Outputs

output "core_function_url" {
  value = replace(replace(aws_lambda_function_url.api_lambda_function_url.function_url, "https://", ""), "/", "")
}

output "core_hicpu_function_url" {
  value = replace(replace(aws_lambda_function_url.hicpu_api_lambda_function_url.function_url, "https://", ""), "/", "")
}

output "core_api_lambda_name" {
  value = local.core_api_lambda_name
}

output "core_api_hicpu_lambda_name" {
  value = local.core_api_hicpu_lambda_name
}


output "core_sqs_consumer_lambda_arn" {
  value = aws_lambda_function.sqs_lambda.arn
}


output "core_sqs_consumer_lambda_name" {
  value = local.core_sqs_consumer_lambda_name
}

output "linkry_redirect_function_arn" {
  value = local.is_primary_deployment ? aws_lambda_function.linkry_edge[0].qualified_arn : ""
}

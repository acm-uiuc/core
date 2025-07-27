data "archive_file" "api_lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../dist/lambda"
  output_path = "${path.module}/../../../dist/terraform/api.zip"
}

locals {
  core_api_lambda_name = "${var.ProjectId}-tf-lambda"
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/lambda/${local.core_api_lambda_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_iam_role" "api_role" {
  name = "${local.core_api_lambda_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Sid    = ""
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceArn" = "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${local.core_api_lambda_name}"
          }
        }
      },
    ]
  })
}

resource "aws_iam_role" "entra_role" {
  name = "${var.ProjectId}-entra-role"
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
    ]
  })
}

resource "aws_iam_policy" "entra_policy" {
  name = "${var.ProjectId}-lambda-shared-policy"
  policy = jsonencode(({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow",
        Action = ["secretsmanager:GetSecretValue"],
        Resource = [
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-entra*",
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-ro-entra*"
        ]
      }
    ]
  }))

}

resource "aws_iam_policy" "shared_iam_policy" {
  name = "${var.ProjectId}-lambda-shared-policy"
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
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-config*",
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-testing-credentials*"
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
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-events",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-events/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-merchstore-purchase-history",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-merchstore-purchase-history/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-events-tickets",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-events-ticketing-metadata",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-merchstore-metadata",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-iam-userroles",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-iam-grouproles",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-iam-stripe-links",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-iam-stripe-links/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-membership-provisioning",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-membership-provisioning/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-membership-external-v3",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-membership-external-v3/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests-status",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-room-requests-status/index/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-linkry",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-keys",

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
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-cache",
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
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-audit-log",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-audit-log/index/*",
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
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-stripe-links/stream/*",
          "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/infra-core-api-events/stream/*",
        ]
      },
      {
        Sid    = "LinkryKvAccess",
        Effect = "Allow",
        Action = [
          "cloudfront-keyvaluestore:*"
        ],
        Resource = [var.LinkryKvArn]
      }
    ]
  }))

}

resource "aws_iam_role_policy_attachment" "api_attach_shared" {
  role       = aws_iam_role.api_role.name
  policy_arn = aws_iam_policy.shared_iam_policy.arn
}

resource "aws_iam_role_policy_attachment" "entra_attach_shared" {
  role       = aws_iam_role.entra_role.name
  policy_arn = aws_iam_policy.shared_iam_policy.arn
}

resource "aws_iam_role_policy_attachment" "entra_attach_specific" {
  role       = aws_iam_role.entra_role.name
  policy_arn = aws_iam_policy.entra_policy.arn
}

resource "aws_lambda_function" "api_lambda" {
  depends_on       = [aws_cloudwatch_log_group.api_logs]
  function_name    = local.core_api_lambda_name
  role             = aws_iam_role.api_role.arn
  architectures    = ["arm64"]
  handler          = "lambda.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.api_lambda_code.output_path
  timeout          = 60
  memory_size      = 2048
  source_code_hash = data.archive_file.api_lambda_code.output_sha256
  environment {
    variables = {
      "RunEnvironment"                      = var.RunEnvironment
      "AWS_CRT_NODEJS_BINARY_RELATIVE_PATH" = "node_modules/aws-crt/dist/bin/linux-arm64-glibc/aws-crt-nodejs.node"
      ORIGIN_VERIFY_KEY                     = var.OriginVerifyKey
      EntraRoleArn                          = aws_iam_role.entra_role.arn
      LinkryKvArn                           = var.LinkryKvArn
      "NODE_OPTIONS"                        = "--enable-source-maps"
    }
  }
}

resource "aws_lambda_alias" "warmer_function_alias" {
  name             = "live"
  description      = "Live environment alias"
  function_name    = aws_lambda_function.api_lambda.arn
  function_version = aws_lambda_function.api_lambda.version
}

resource "aws_lambda_function_url" "api_lambda_function_url" {
  function_name      = aws_lambda_function.api_lambda.function_name
  authorization_type = "NONE"
}

output "core_function_url" {
  value = aws_lambda_function_url.api_lambda_function_url.function_url
}

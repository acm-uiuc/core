data "archive_file" "lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../dist/dirsync"
  output_path = "${path.module}/../../../dist/terraform/dirsync.zip"
}
locals {
  sync_lambda_name = "${var.ProjectId}-gsuite-dirsync"
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.sync_lambda_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_iam_role" "this" {
  name = "${local.sync_lambda_name}-exec-role"
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

resource "aws_iam_policy" "this" {
  name = "${local.sync_lambda_name}-base-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Effect   = "Allow",
        Resource = ["${aws_cloudwatch_log_group.archive_logs.arn}:*"]
      },
      {
        Action = ["secretsmanager:GetSecretValue"],
        Effect = "Allow",
        Resource = [
          "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:infra-core-api-gsuite-dirsync*",
        ]
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.this.arn
}

resource "aws_lambda_function" "this" {
  depends_on       = [aws_cloudwatch_log_group.this]
  function_name    = local.sync_lambda_name
  role             = aws_iam_role.this.arn
  architectures    = ["arm64"]
  handler          = "sync.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.lambda_code.output_path
  timeout          = 900
  memory_size      = 2048
  source_code_hash = data.archive_file.lambda_code.output_sha256
  description      = "GSuite Sync Lambda."
  environment {
    variables = {
      "RunEnvironment" = var.RunEnvironment
    }
  }
}

resource "aws_cloudwatch_event_rule" "this" {
  name                = "${local.sync_lambda_name}-schedule"
  description         = "Trigger GSuite directory sync on a schedule"
  schedule_expression = var.SyncFrequency
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.this.arn
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.this.name
  target_id = "DirsyncLambdaTarget"
  arn       = aws_lambda_function.this.arn
}

resource "aws_secretsmanager_secret" "config" {
  name        = "infra-core-api-gsuite-dirsync"
  description = "Configuration for Entra ID to Google Workspace directory sync"

  lifecycle {
    ignore_changes = [
      name,
      description,
    ]
  }
}

resource "aws_secretsmanager_secret_version" "config" {
  secret_id = aws_secretsmanager_secret.config.id
  secret_string = jsonencode({
    entraTenantId       = "REPLACE_WITH_TENANT_ID"
    entraClientId       = "REPLACE_WITH_CLIENT_ID"
    entraClientSecret   = "REPLACE_WITH_CLIENT_SECRET"
    googleDelegatedUser = "admin@yourdomain.com"
    googleServiceAccountJson = jsonencode({
      type                        = "service_account"
      project_id                  = "REPLACE_WITH_PROJECT_ID"
      private_key_id              = "REPLACE_WITH_PRIVATE_KEY_ID"
      private_key                 = "REPLACE_WITH_PRIVATE_KEY"
      client_email                = "REPLACE_WITH_CLIENT_EMAIL"
      client_id                   = "REPLACE_WITH_CLIENT_ID"
      auth_uri                    = "https://accounts.google.com/o/oauth2/auth"
      token_uri                   = "https://oauth2.googleapis.com/token"
      auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
      client_x509_cert_url        = "REPLACE_WITH_CERT_URL"
    })
    deleteRemovedContacts = false
  })

  lifecycle {
    ignore_changes = [
      secret_string,
    ]
  }
}

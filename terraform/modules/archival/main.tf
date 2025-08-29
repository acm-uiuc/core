data "archive_file" "api_lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../src/data-archive"
  output_path = "${path.module}/../../../dist/terraform/data-archive.zip"
}

locals {
  archive_lambda_name  = "${var.ProjectId}-ddb-archival"
  firehose_stream_name = "${var.ProjectId}-ddb-archival-stream"
}
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "archive_logs" {
  name              = "/aws/lambda/${local.archive_lambda_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_s3_bucket" "this" {
  bucket = "${var.BucketPrefix}-ddb-archive"
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "AbortIncompleteMultipartUploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "intelligent-tiering-transition"
    status = "Enabled"

    transition {
      days          = 1
      storage_class = "INTELLIGENT_TIERING"
    }
  }
}

resource "aws_s3_bucket_intelligent_tiering_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  name   = "ArchiveAfterSixMonths"
  status = "Enabled"
  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 180
  }
}


resource "aws_iam_role" "archive_role" {
  name = "${local.archive_lambda_name}-exec-role"
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

resource "aws_iam_policy" "archive_lambda_policy" {
  name = "${local.archive_lambda_name}-logging-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Effect   = "Allow",
        Resource = ["${aws_cloudwatch_log_group.archive_logs.arn}:*"]
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "archive_lambda_policy_attach" {
  role       = aws_iam_role.archive_role.name
  policy_arn = aws_iam_policy.archive_lambda_policy.arn
}

resource "aws_iam_policy" "archive_policy" {
  name = "${local.archive_lambda_name}-ddb-stream-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        for table in var.MonitorTables : {
          Effect = "Allow"
          Action = [
            "dynamodb:DescribeStream",
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
            "dynamodb:ListStreams"
          ]
          Resource = "arn:aws:dynamodb:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:table/${table}/stream/*"
        }
      ],
      [
        {
          Effect = "Allow"
          Action = [
            "s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject"
          ]
          Resource = ["arn:aws:s3:::${aws_s3_bucket.this.id}/*", "arn:aws:s3:::${aws_s3_bucket.this.id}"]
        },
      ]
    )
  })
}

resource "aws_iam_role_policy_attachment" "archive_attach" {
  role       = aws_iam_role.archive_role.name
  policy_arn = aws_iam_policy.archive_policy.arn
}

resource "aws_lambda_function" "api_lambda" {
  depends_on       = [aws_cloudwatch_log_group.archive_logs]
  function_name    = local.archive_lambda_name
  role             = aws_iam_role.archive_role.arn
  architectures    = ["arm64"]
  handler          = "lambda.handler"
  runtime          = "python3.13"
  filename         = data.archive_file.api_lambda_code.output_path
  timeout          = 90
  memory_size      = 512
  source_code_hash = data.archive_file.api_lambda_code.output_sha256
  description      = "DynamoDB stream reader to archive data."
  environment {
    variables = {
      "RunEnvironment"       = var.RunEnvironment
      "FIREHOSE_STREAM_NAME" = local.firehose_stream_name
    }
  }
}

data "aws_dynamodb_table" "existing_tables" {
  for_each = toset(var.MonitorTables)
  name     = each.key
}

resource "aws_lambda_event_source_mapping" "stream_mapping" {
  for_each                = toset(var.MonitorTables)
  function_name           = aws_lambda_function.api_lambda.arn
  event_source_arn        = data.aws_dynamodb_table.existing_tables[each.key].stream_arn
  function_response_types = ["ReportBatchItemFailures"]
  batch_size              = 10
  enabled                 = true
  starting_position       = "LATEST"

  filter_criteria {
    filter {
      pattern = jsonencode({
        userIdentity = {
          type        = ["Service"]
          principalId = ["dynamodb.amazonaws.com"]
        }
      })
    }
  }

  depends_on = [aws_iam_policy.archive_policy]
}

// firehose

resource "aws_iam_role" "firehose_role" {
  name = "${local.firehose_stream_name}-exec-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "firehose.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "firehose_policy" {
  name = "${local.firehose_stream_name}-s3-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.this.arn,
          "${aws_s3_bucket.this.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = ["arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/kinesisfirehose/${local.firehose_stream_name}:*"]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "firehose_attach" {
  role       = aws_iam_role.firehose_role.name
  policy_arn = aws_iam_policy.firehose_policy.arn
}

resource "aws_kinesis_firehose_delivery_stream" "dynamic_stream" {
  name        = local.firehose_stream_name
  destination = "extended_s3"

  extended_s3_configuration {
    bucket_arn         = aws_s3_bucket.this.arn
    role_arn           = aws_iam_role.firehose_role.arn
    buffering_interval = 60
    buffering_size     = 10
    compression_format = "GZIP"

    dynamic_partitioning_configuration {
      enabled = true
    }

    processing_configuration {
      enabled = true
      processors {
        type = "MetadataExtraction"
        parameters {
          parameter_name  = "MetadataExtractionQuery"
          parameter_value = "{table:.table}"
        }
        parameters {
          parameter_name  = "JsonParsingEngine"
          parameter_value = "JQ-1.6"
        }
      }
    }

    prefix              = "table=!{partitionKeyFromQuery:table}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/"
    error_output_prefix = "firehose-errors/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/"
  }
}

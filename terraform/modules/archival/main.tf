data "archive_file" "api_lambda_code" {
  type        = "zip"
  source_dir  = "${path.module}/../../../dist/archival"
  output_path = "${path.module}/../../../dist/terraform/archival.zip"
}

locals {
  aws_region                       = "us-east-2"
  dynamo_stream_reader_lambda_name = "${var.ProjectId}-${local.aws_region}-dynamo-archival"
  firehose_stream_name             = "${var.ProjectId}-${local.aws_region}-archival-stream"
  bucket_prefix                    = "${data.aws_caller_identity.current.account_id}-${local.aws_region}"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "archive_logs" {
  region            = local.aws_region
  name              = "/aws/lambda/${local.dynamo_stream_reader_lambda_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_cloudwatch_log_group" "firehose_logs" {
  region            = local.aws_region
  name              = "/aws/kinesisfirehose/${local.firehose_stream_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_cloudwatch_log_stream" "firehose_logs_stream" {
  region         = local.aws_region
  log_group_name = aws_cloudwatch_log_group.firehose_logs.name
  name           = "DataArchivalS3Delivery"
}


resource "aws_s3_bucket" "this" {
  region = local.aws_region
  bucket = "${local.bucket_prefix}-ddb-archive"
}

resource "aws_s3_bucket_versioning" "this" {
  region = local.aws_region
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  region = local.aws_region
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

    filter {}

    transition {
      days          = 1
      storage_class = "INTELLIGENT_TIERING"
    }
  }

  rule {
    id     = "ExpireNoncurrentVersions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 5
    }
  }

  dynamic "rule" {
    for_each = var.TableDeletionDays

    content {
      id     = "expire-${rule.key}"
      status = "Enabled"

      filter {
        prefix = "resource=${rule.key}/"
      }

      expiration {
        days = rule.value
      }
    }
  }
}

resource "aws_s3_bucket_intelligent_tiering_configuration" "this" {
  region = local.aws_region
  bucket = aws_s3_bucket.this.id
  name   = "ArchiveAfterSixMonths"
  status = "Enabled"
  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 180
  }
}


resource "aws_iam_role" "archive_role" {
  name = "${local.dynamo_stream_reader_lambda_name}-exec-role"
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
  name = "${local.dynamo_stream_reader_lambda_name}-logging-policy"
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


data "aws_dynamodb_table" "existing_tables" {
  region   = local.aws_region
  for_each = toset(var.MonitorTables)
  name     = each.key
}

resource "aws_lambda_event_source_mapping" "stream_mapping" {
  region                  = local.aws_region
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
  region      = local.aws_region
  name        = local.firehose_stream_name
  destination = "extended_s3"

  extended_s3_configuration {
    bucket_arn         = aws_s3_bucket.this.arn
    role_arn           = aws_iam_role.firehose_role.arn
    buffering_interval = 60
    buffering_size     = 64
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
          parameter_value = "{resource: .__infra_archive_resource, year: (.__infra_archive_timestamp | fromdateiso8601 | strftime(\"%Y\")), month: (.__infra_archive_timestamp | fromdateiso8601 |  strftime(\"%m\")), day: (.__infra_archive_timestamp | fromdateiso8601 | strftime(\"%d\"))}"
        }
        parameters {
          parameter_name  = "JsonParsingEngine"
          parameter_value = "JQ-1.6"
        }
      }
    }
    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose_logs.name
      log_stream_name = aws_cloudwatch_log_stream.firehose_logs_stream.name
    }

    prefix              = "resource=!{partitionKeyFromQuery:resource}/year=!{partitionKeyFromQuery:year}/month=!{partitionKeyFromQuery:month}/day=!{partitionKeyFromQuery:day}/"
    error_output_prefix = "firehose-errors/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/"
  }
}

resource "aws_iam_role_policy_attachment" "archive_lambda_policy_attach" {
  role       = aws_iam_role.archive_role.name
  policy_arn = aws_iam_policy.archive_lambda_policy.arn
}

resource "aws_iam_policy" "archive_policy" {
  name = "${local.dynamo_stream_reader_lambda_name}-ddb-stream-policy"

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
            "firehose:PutRecordBatch",
          ]
          Resource = [aws_kinesis_firehose_delivery_stream.dynamic_stream.arn]
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
  region           = local.aws_region
  depends_on       = [aws_cloudwatch_log_group.archive_logs]
  function_name    = local.dynamo_stream_reader_lambda_name
  role             = aws_iam_role.archive_role.arn
  architectures    = ["arm64"]
  handler          = "dynamoStream.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.api_lambda_code.output_path
  timeout          = 90
  memory_size      = 512
  source_code_hash = data.archive_file.api_lambda_code.output_sha256
  description      = "DynamoDB TTL stream to archival firehose."
  environment {
    variables = {
      "RunEnvironment"       = var.RunEnvironment
      "FIREHOSE_STREAM_NAME" = local.firehose_stream_name
    }
  }
}

output "dynamo_archival_lambda_name" {
  value = local.dynamo_stream_reader_lambda_name
}

output "firehose_stream_name" {
  value = local.firehose_stream_name
}

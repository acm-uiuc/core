
resource "null_resource" "onetime_auditlog" {
  provisioner "local-exec" {
    command     = <<-EOT
      set -e
      python auditlog-migration.py
    EOT
    interpreter = ["bash", "-c"]
    working_dir = "${path.module}/../../../onetime/"
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  firehose_stream_name = "${var.ProjectId}-audit-log-stream"
  glue_db_name         = "${replace(var.ProjectId, "-", "_")}_audit_logs"
  glue_table_name      = "logs"
  s3_bucket_name       = "${var.BucketPrefix}-audit-logs"
}

# 1. S3 Bucket and Configuration (No changes)
resource "aws_s3_bucket" "this" {
  bucket = local.s3_bucket_name
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
  rule {
    id     = "DeleteAuditLogsAfterDays"
    status = "Enabled"
    filter {}
    expiration {
      days = var.DataExpirationDays
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

resource "aws_cloudwatch_log_group" "firehose_logs" {
  name              = "/aws/kinesisfirehose/${local.firehose_stream_name}"
  retention_in_days = var.LogRetentionDays
}

resource "aws_cloudwatch_log_stream" "firehose_logs_stream" {
  log_group_name = aws_cloudwatch_log_group.firehose_logs.name
  name           = "DataArchivalS3Delivery"
}

# 3. AWS Glue Catalog for Parquet Conversion (No changes)
resource "aws_glue_catalog_table" "this" {
  name          = local.glue_table_name
  database_name = aws_glue_catalog_database.this.name
  table_type    = "EXTERNAL_TABLE"
  parameters = {
    "EXTERNAL"            = "TRUE"
    "parquet.compression" = "SNAPPY"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.this.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"
    ser_de_info {
      name                  = "parquet-serde"
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
      parameters            = { "serialization.format" = "1" }
    }

    columns {
      name = "createdAt"
      type = "bigint"
    }
    columns {
      name = "actor"
      type = "string"
    }
    columns {
      name = "message"
      type = "string"
    }
    columns {
      name = "requestId"
      type = "string"
    }
    columns {
      name = "target"
      type = "string"
    }
  }
  partition_keys {
    name = "module"
    type = "string"
  }
  partition_keys {
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
  }
  partition_keys {
    name = "hour"
    type = "string"
  }
}

resource "aws_glue_catalog_database" "this" {
  name = local.glue_db_name
}


resource "aws_iam_role" "firehose_role" {
  name = "${local.firehose_stream_name}-exec-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action    = "sts:AssumeRole",
      Effect    = "Allow",
      Principal = { Service = "firehose.amazonaws.com" }
    }]
  })
}

resource "aws_iam_policy" "firehose_policy" {
  name = "${local.firehose_stream_name}-s3-policy"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:AbortMultipartUpload", "s3:GetBucketLocation", "s3:GetObject",
          "s3:ListBucket", "s3:ListBucketMultipartUploads", "s3:PutObject"
        ],
        Resource = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      },
      {
        Effect   = "Allow",
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource = [aws_cloudwatch_log_group.firehose_logs.arn]
      },
      {
        Effect = "Allow",
        Action = ["glue:GetTable", "glue:GetTableVersion", "glue:GetTableVersions"],
        Resource = [
          "arn:aws:glue:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:catalog",
          aws_glue_catalog_database.this.arn,
          aws_glue_catalog_table.this.arn
        ]
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
    compression_format = "UNCOMPRESSED"
    buffering_interval = 60
    buffering_size     = 128

    data_format_conversion_configuration {
      enabled = true
      input_format_configuration {
        deserializer {
          open_x_json_ser_de {}
        }
      }
      output_format_configuration {
        serializer {
          parquet_ser_de {}
        }
      }
      schema_configuration {
        database_name = aws_glue_catalog_database.this.name
        table_name    = aws_glue_catalog_table.this.name
        role_arn      = aws_iam_role.firehose_role.arn
      }
    }

    processing_configuration {
      enabled = true
      processors {
        type = "MetadataExtraction"
        parameters {
          parameter_name  = "MetadataExtractionQuery"
          parameter_value = "{module: .module, year: (.createdAt | strftime(\"%Y\")), month: (.createdAt | strftime(\"%m\")), day: (.createdAt | strftime(\"%d\")), hour: (.createdAt | strftime(\"%H\"))}"
        }
        parameters {
          parameter_name  = "JsonParsingEngine"
          parameter_value = "JQ-1.6"
        }
      }
    }

    dynamic_partitioning_configuration {
      enabled = true
    }

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose_logs.name
      log_stream_name = aws_cloudwatch_log_stream.firehose_logs_stream.name
    }

    prefix              = "module=!{partitionKeyFromQuery:module}/year=!{partitionKeyFromQuery:year}/month=!{partitionKeyFromQuery:month}/day=!{partitionKeyFromQuery:day}/hour=!{partitionKeyFromQuery:hour}/"
    error_output_prefix = "firehose-errors/!{firehose:error-output-type}/!{timestamp:yyyy/MM/dd}/"
  }
}

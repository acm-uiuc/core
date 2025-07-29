locals {
  kinesis_stream_name = "${var.ProjectId}-audit-log-delivery"
}
resource "aws_s3_bucket" "audit_log_storage" {
  bucket = "${var.BucketPrefix}-${var.ProjectId}-audit-logs"
}

resource "aws_cloudwatch_log_group" "firehose_log_group" {
  name = "/aws/kinesisfirehose/${local.kinesis_stream_name}-delivery"
}

resource "aws_cloudwatch_log_stream" "firehose_log_stream" {
  name           = "/aws/kinesisfirehose/${local.kinesis_stream_name}-stream"
  log_group_name = aws_cloudwatch_log_group.firehose_log_group.name
}

resource "aws_kinesis_stream" "audit_log_stream" {
  name             = local.kinesis_stream_name
  retention_period = 24

  stream_mode_details {
    stream_mode = "ON_DEMAND"
  }
}
resource "aws_glue_catalog_database" "audit_log_database" {
  name = "${var.ProjectId}-audit-log-database"
}

resource "aws_glue_catalog_table" "audit_log_table" {
  name          = "${var.ProjectId}-audit-logs"
  database_name = aws_glue_catalog_database.audit_log_database.name

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "EXTERNAL"           = "TRUE"
    "projection.enabled" = "false"
    "classification"     = "json"
    "compressionType"    = "none"
    "typeOfData"         = "file"
  }

  storage_descriptor {
    columns {
      name = "module"
      type = "string"
    }
    columns {
      name = "createdAt"
      type = "timestamp"
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
      name = "target"
      type = "string"
    }

    location      = "s3://${aws_s3_bucket.audit_log_storage.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      name                  = "JsonSerDe"
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "dots.in.keys"         = "false"
        "case.insensitive"     = "false"
        "mapping"              = "true"
        "serialization.format" = "1"
      }
    }
  }
}

resource "aws_kinesis_firehose_delivery_stream" "audit_log_delivery_stream" {
  name        = "${local.kinesis_stream_name}-delivery"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn   = aws_iam_role.firehose.arn
    bucket_arn = aws_s3_bucket.audit_log_storage.arn

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
        role_arn      = aws_iam_role.firehose.arn
        database_name = aws_glue_catalog_database.audit_log_database.name
        table_name    = aws_glue_catalog_table.audit_log_table.name
      }
    }

    cloudwatch_logging_options {
      enabled         = "true"
      log_group_name  = aws_cloudwatch_log_group.firehose_log_group.name
      log_stream_name = aws_cloudwatch_log_stream.firehose_log_stream.name
    }
  }

  kinesis_source_configuration {
    kinesis_stream_arn = aws_kinesis_stream.audit_log_stream.arn
    role_arn           = aws_iam_role.firehose.arn
  }
}

resource "aws_iam_role" "firehose" {
  name = "${var.ProjectId}-firehose-assume-role"

  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "firehose.amazonaws.com"
      },
      "Effect": "Allow",
      "Sid": ""
    }
  ]
}
EOF
}

resource "aws_iam_policy" "firehose_s3" {
  name_prefix = "${var.ProjectId}-auditlog"
  policy      = <<-EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
        "Sid": "",
        "Effect": "Allow",
        "Action": [
            "s3:AbortMultipartUpload",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:ListBucketMultipartUploads",
            "s3:PutObject"
        ],
        "Resource": [
            "${aws_s3_bucket.audit_log_storage.arn}",
            "${aws_s3_bucket.audit_log_storage.arn}/*"
        ]
    }
  ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "firehose_s3" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.firehose_s3.arn
}

resource "aws_iam_policy" "put_record" {
  name   = "${var.ProjectId}-auditlog-putrecord"
  policy = <<-EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "firehose:PutRecord",
                "firehose:PutRecordBatch"
            ],
            "Resource": [
                "${aws_kinesis_firehose_delivery_stream.audit_log_delivery_stream.arn}"
            ]
        }
    ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "put_record" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.put_record.arn
}

resource "aws_iam_policy" "firehose_cloudwatch" {
  name_prefix = "${var.ProjectId}-auditlog"

  policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
        "Sid": "",
        "Effect": "Allow",
        "Action": [
            "logs:CreateLogStream",
            "logs:PutLogEvents"
        ],
        "Resource": [
            "${aws_cloudwatch_log_group.firehose_log_group.arn}"
        ]
    }
  ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "firehose_cloudwatch" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.firehose_cloudwatch.arn
}

resource "aws_iam_policy" "kinesis_firehose" {
  name_prefix = "${var.ProjectId}-auditlog"

  policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
        "Sid": "",
        "Effect": "Allow",
        "Action": [
            "kinesis:DescribeStream",
            "kinesis:GetShardIterator",
            "kinesis:GetRecords",
            "kinesis:ListShards"
        ],
        "Resource": "${aws_kinesis_stream.audit_log_stream.arn}"
    }
  ]
}
EOF
}

resource "aws_iam_role_policy_attachment" "kinesis_firehose" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.kinesis_firehose.arn
}

resource "aws_iam_policy" "firehose_glue" {
  name_prefix = "${var.ProjectId}-firehose-glue"
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "glue:GetTable",
          "glue:GetTableVersion",
          "glue:GetTableVersions"
        ],
        Resource = [
          aws_glue_catalog_table.audit_log_table.arn,
          aws_glue_catalog_database.audit_log_database.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "firehose_glue" {
  role       = aws_iam_role.firehose.name
  policy_arn = aws_iam_policy.firehose_glue.arn
}


output "firehose_put_policy_arn" {
  value = aws_iam_policy.put_record.arn
}

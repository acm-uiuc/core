output "firehose_delivery_stream_name" {
  description = "The name of the Kinesis Firehose delivery stream."
  value       = aws_kinesis_firehose_delivery_stream.dynamic_stream.name
}

output "firehose_delivery_stream_arn" {
  description = "The ARN of the Kinesis Firehose delivery stream."
  value       = aws_kinesis_firehose_delivery_stream.dynamic_stream.arn
}

output "s3_bucket_name" {
  description = "The name of the S3 bucket where data is stored."
  value       = aws_s3_bucket.this.bucket
}

output "glue_database_name" {
  description = "The name of the AWS Glue database."
  value       = aws_glue_catalog_database.this.name
}

output "glue_table_name" {
  description = "The name of the AWS Glue table."
  value       = aws_glue_catalog_table.this.name
}

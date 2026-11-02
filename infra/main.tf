# Amazon Connect support desk with agent assist — a proof of concept, deliberately small.
# One instance, one queue, one agent, a chat flow and a voice flow, a Lambda that pre-fetches a suggested
# answer from a retrieval-augmented support service, and a second Lambda that starts web chats.

locals {
  name = "support-desk"
}

resource "random_id" "suffix" { byte_length = 3 }

resource "random_password" "agent" {
  length           = 20
  special          = true
  override_special = "!@#%^*-_=+"
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 1
}

resource "random_password" "start_key" {
  length  = 40
  special = false
}

# ---------------------------------------------------------------- instance
resource "aws_connect_instance" "this" {
  identity_management_type         = "CONNECT_MANAGED"
  instance_alias                   = "${var.instance_alias}-${random_id.suffix.hex}"
  inbound_calls_enabled            = true
  outbound_calls_enabled           = true
  contact_lens_enabled             = true
  auto_resolve_best_voices_enabled = true
  early_media_enabled              = true
}

resource "aws_connect_hours_of_operation" "always" {
  instance_id = aws_connect_instance.this.id
  name        = "Always open"
  description = "24x7 for the proof of concept"
  time_zone   = "America/New_York"
  dynamic "config" {
    for_each = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    content {
      day = config.value
      start_time {
        hours   = 0
        minutes = 0
      }
      end_time {
        hours   = 23
        minutes = 59
      }
    }
  }
}

resource "aws_connect_queue" "support" {
  instance_id           = aws_connect_instance.this.id
  name                  = "Support"
  description           = "Web chat and voice, one queue"
  hours_of_operation_id = aws_connect_hours_of_operation.always.hours_of_operation_id
  max_contacts          = 10
}

resource "aws_connect_routing_profile" "support" {
  instance_id               = aws_connect_instance.this.id
  name                      = "Support agent"
  description               = "Voice and chat from the Support queue"
  default_outbound_queue_id = aws_connect_queue.support.queue_id

  media_concurrencies {
    channel     = "VOICE"
    concurrency = 1
  }
  media_concurrencies {
    channel     = "CHAT"
    concurrency = 3
  }

  queue_configs {
    channel  = "VOICE"
    delay    = 0
    priority = 1
    queue_id = aws_connect_queue.support.queue_id
  }
  queue_configs {
    channel  = "CHAT"
    delay    = 0
    priority = 1
    queue_id = aws_connect_queue.support.queue_id
  }
}

data "aws_connect_security_profile" "agent" {
  instance_id = aws_connect_instance.this.id
  name        = "Agent"
}

resource "aws_connect_user" "agent" {
  instance_id          = aws_connect_instance.this.id
  name                 = var.agent_username
  password             = random_password.agent.result
  routing_profile_id   = aws_connect_routing_profile.support.routing_profile_id
  security_profile_ids = [data.aws_connect_security_profile.agent.security_profile_id]
  identity_info {
    first_name = var.agent_first_name
    last_name  = var.agent_last_name
    email      = var.agent_email
  }
  phone_config {
    phone_type                    = "SOFT_PHONE"
    auto_accept                   = false
    after_contact_work_time_limit = 30
  }
  lifecycle { ignore_changes = [password] }
}

# ---------------------------------------------------------------- recordings + transcripts (Contact Lens)
resource "aws_kms_key" "connect" {
  description             = "Amazon Connect recordings and transcripts"
  deletion_window_in_days = 7
}

resource "aws_s3_bucket" "connect" {
  bucket        = "${local.name}-connect-${random_id.suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "connect" {
  bucket                  = aws_s3_bucket.connect.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_connect_instance_storage_config" "recordings" {
  instance_id   = aws_connect_instance.this.id
  resource_type = "CALL_RECORDINGS"
  storage_config {
    storage_type = "S3"
    s3_config {
      bucket_name   = aws_s3_bucket.connect.id
      bucket_prefix = "recordings"
      encryption_config {
        encryption_type = "KMS"
        key_id          = aws_kms_key.connect.arn
      }
    }
  }
}

resource "aws_connect_instance_storage_config" "transcripts" {
  instance_id   = aws_connect_instance.this.id
  resource_type = "CHAT_TRANSCRIPTS"
  storage_config {
    storage_type = "S3"
    s3_config {
      bucket_name   = aws_s3_bucket.connect.id
      bucket_prefix = "transcripts"
      encryption_config {
        encryption_type = "KMS"
        key_id          = aws_kms_key.connect.arn
      }
    }
  }
}

# ---------------------------------------------------------------- lambdas
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "assist" {
  name               = "${local.name}-assist-${random_id.suffix.hex}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "assist_logs" {
  role       = aws_iam_role.assist.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "assist" {
  type        = "zip"
  source_file = "${path.module}/../lambda/dist/assist.mjs"
  output_path = "${path.module}/build/assist.zip"
}

resource "aws_lambda_function" "assist" {
  function_name    = "${local.name}-assist"
  role             = aws_iam_role.assist.arn
  runtime          = "nodejs22.x"
  handler          = "assist.handler"
  architectures    = ["arm64"]
  filename         = data.archive_file.assist.output_path
  source_code_hash = data.archive_file.assist.output_base64sha256
  timeout          = 25
  memory_size      = 256
  environment {
    variables = {
      RAG_URL        = var.rag_url
      ALLOWED_ORIGIN = var.allowed_origin
    }
  }
}

resource "aws_lambda_function_url" "assist" {
  function_name      = aws_lambda_function.assist.function_name
  authorization_type = "NONE"
  cors {
    allow_origins = [var.allowed_origin]
    allow_methods = ["POST"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_lambda_permission" "assist_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.assist.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_connect_lambda_function_association" "assist" {
  instance_id  = aws_connect_instance.this.id
  function_arn = aws_lambda_function.assist.arn
}

resource "aws_iam_role" "start_chat" {
  name               = "${local.name}-start-chat-${random_id.suffix.hex}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "start_chat_logs" {
  role       = aws_iam_role.start_chat.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "start_chat" {
  statement {
    actions   = ["connect:StartChatContact"]
    resources = ["${aws_connect_instance.this.arn}/contact-flow/*", "${aws_connect_instance.this.arn}/contact/*", aws_connect_instance.this.arn]
  }
}

resource "aws_iam_role_policy" "start_chat" {
  role   = aws_iam_role.start_chat.id
  policy = data.aws_iam_policy_document.start_chat.json
}

data "archive_file" "start_chat" {
  type        = "zip"
  source_file = "${path.module}/../lambda/dist/start-chat.mjs"
  output_path = "${path.module}/build/start-chat.zip"
}

resource "aws_lambda_function" "start_chat" {
  function_name    = "${local.name}-start-chat"
  role             = aws_iam_role.start_chat.arn
  runtime          = "nodejs22.x"
  handler          = "start-chat.handler"
  architectures    = ["arm64"]
  filename         = data.archive_file.start_chat.output_path
  source_code_hash = data.archive_file.start_chat.output_base64sha256
  timeout          = 10
  memory_size      = 256
  environment {
    variables = {
      INSTANCE_ID     = aws_connect_instance.this.id
      CONTACT_FLOW_ID = aws_connect_contact_flow.chat.contact_flow_id
      START_KEY       = random_password.start_key.result
    }
  }
}

resource "aws_lambda_function_url" "start_chat" {
  function_name      = aws_lambda_function.start_chat.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "start_chat_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.start_chat.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# ---------------------------------------------------------------- flows
resource "aws_connect_contact_flow" "chat" {
  instance_id = aws_connect_instance.this.id
  name        = "Web chat with agent assist"
  description = "Pre-fetch a suggested answer, check staffing, queue to Support"
  type        = "CONTACT_FLOW"
  content = templatefile("${path.module}/flows/chat.json.tftpl", {
    assist_arn = aws_lambda_function.assist.arn
    queue_arn  = aws_connect_queue.support.arn
  })
  depends_on = [aws_connect_lambda_function_association.assist]
}

resource "aws_connect_contact_flow" "voice" {
  instance_id = aws_connect_instance.this.id
  name        = "Voice with Contact Lens"
  description = "Record and analyse, check staffing, queue to Support"
  type        = "CONTACT_FLOW"
  content = templatefile("${path.module}/flows/voice.json.tftpl", {
    queue_arn = aws_connect_queue.support.arn
  })
}

resource "aws_connect_phone_number" "main" {
  count        = var.claim_phone_number ? 1 : 0
  target_arn   = aws_connect_instance.this.arn
  country_code = "US"
  type         = "DID"
  description  = "Support desk proof of concept"
}

resource "aws_connect_phone_number_contact_flow_association" "main" {
  count           = var.claim_phone_number ? 1 : 0
  instance_id     = aws_connect_instance.this.id
  phone_number_id = aws_connect_phone_number.main[0].id
  contact_flow_id = aws_connect_contact_flow.voice.contact_flow_id
}

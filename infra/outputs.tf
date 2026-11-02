output "instance_id" {
  value = aws_connect_instance.this.id
}

output "instance_alias" {
  value = aws_connect_instance.this.instance_alias
}

output "ccp_url" {
  value = "https://${aws_connect_instance.this.instance_alias}.my.connect.aws/ccp-v2/"
}

output "admin_url" {
  value = "https://${aws_connect_instance.this.instance_alias}.my.connect.aws/"
}

output "chat_flow_id" {
  value = aws_connect_contact_flow.chat.contact_flow_id
}

output "assist_url" {
  value = aws_lambda_function_url.assist.function_url
}

output "start_chat_url" {
  value = aws_lambda_function_url.start_chat.function_url
}

output "phone_number" {
  value = var.claim_phone_number ? aws_connect_phone_number.main[0].phone_number : null
}

output "agent_username" {
  value = var.agent_username
}

output "agent_password" {
  value     = random_password.agent.result
  sensitive = true
}

output "start_key" {
  value     = random_password.start_key.result
  sensitive = true
}

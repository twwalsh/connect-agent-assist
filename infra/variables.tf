variable "region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "tw-mcp"
}

variable "instance_alias" {
  type        = string
  description = "Globally unique Amazon Connect instance alias (a random suffix is appended)"
  default     = "fruitless-support-desk"
}

variable "agent_username" {
  type    = string
  default = "tw"
}

variable "agent_first_name" {
  type    = string
  default = "Tim"
}

variable "agent_last_name" {
  type    = string
  default = "Walsh"
}

variable "agent_email" {
  type    = string
  default = "tw@twwalsh.com"
}

variable "rag_url" {
  type        = string
  description = "Base URL of the retrieval-augmented support service (POST /ask)"
  default     = "https://support-rag.wonderfulhill-bd947026.eastus.azurecontainerapps.io"
}

variable "allowed_origin" {
  type        = string
  description = "Browser origin allowed to call the assist URL and to embed the CCP"
  default     = "https://twwalsh.com"
}

variable "claim_phone_number" {
  type        = bool
  description = "Claim a US DID for the voice channel (false if the account cannot claim numbers yet)"
  default     = true
}

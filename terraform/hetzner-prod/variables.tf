variable "domain" {
  description = "Production public hostname."
  type        = string
  default     = "fishing-assistant.online"

  validation {
    condition     = var.domain == "fishing-assistant.online"
    error_message = "domain is fixed to fishing-assistant.online for V1 production."
  }
}

variable "server_name" {
  description = "Hetzner production server name."
  type        = string
  default     = "fa-prod-1"
}

variable "hetzner_location" {
  description = "Hetzner location."
  type        = string
  default     = "nbg1"
}

variable "hetzner_server_type" {
  description = "Hetzner server class for production."
  type        = string
  default     = "cx33"
}

variable "hetzner_image" {
  description = "Hetzner image."
  type        = string
  default     = "ubuntu-24.04"
}

variable "deploy_ssh_public_key" {
  description = "Public SSH key allowed for deploy/bootstrap access."
  type        = string
  sensitive   = true
}

variable "ssh_allowed_cidrs" {
  description = "CIDR ranges allowed to SSH. Narrow before production traffic if possible."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "enable_backups" {
  description = "Enable Hetzner VM backups."
  type        = bool
  default     = true
}

variable "generated_file_notice" {
  description = "Generated service URL notice emitted by service wiring."
  type        = string
  default     = ""
}

variable "service_urls" {
  description = "Generated browser-facing service URLs emitted by service wiring."
  type        = map(string)
  default     = {}
}

variable "labels" {
  description = "Additional labels for Hetzner resources."
  type        = map(string)
  default     = {}
}

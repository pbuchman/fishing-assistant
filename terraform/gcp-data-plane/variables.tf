variable "project_id" {
  description = "FA GCP project id."
  type        = string
  default     = "replace-with-gcp-project-id"

  validation {
    condition     = length(trimspace(var.project_id)) > 0 && !startswith(var.project_id, "replace-with-")
    error_message = "project_id must be set to a real GCP project id before apply."
  }
}

variable "region" {
  description = "Primary retained data-plane region."
  type        = string
  default     = "europe-central2"
}

variable "terraform_state_bucket" {
  description = "Bootstrap-created bucket used by Terraform remote state."
  type        = string
  default     = "replace-with-terraform-state-bucket"
}

variable "firestore_backup_bucket" {
  description = "Bucket used by the Firestore export runbook."
  type        = string
  default     = "replace-with-firestore-backup-bucket"
}

variable "shared_content_bucket" {
  description = "Public bucket used for world-readable share artifacts."
  type        = string
  default     = "replace-with-shared-content-bucket"
}

variable "labels" {
  description = "Additional labels for retained GCP resources."
  type        = map(string)
  default     = {}
}

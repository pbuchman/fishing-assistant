output "project_id" {
  description = "Dedicated FA GCP project."
  value       = var.project_id
}

output "firestore_database" {
  description = "Firestore Native database id."
  value       = google_firestore_database.default.name
}

output "hetzner_provisioner_service_account" {
  description = "Service account used by Hetzner deploy/provisioning scripts."
  value       = google_service_account.hetzner_provisioner.email
}

output "hetzner_runtime_service_account" {
  description = "Service account mounted into the production services container."
  value       = google_service_account.hetzner_runtime.email
}

output "firestore_backup_bucket" {
  description = "Firestore export bucket."
  value       = google_storage_bucket.firestore_backups.name
}

output "shared_content_bucket" {
  description = "Public bucket used by the Codex share skill."
  value       = google_storage_bucket.shared_content.name
}

output "shared_content_public_base_url" {
  description = "Public base URL for share skill artifacts."
  value       = "https://fishing-assistant.online/share/"
}

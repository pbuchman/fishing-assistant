locals {
  common_labels = merge(
    {
      application = "fishing-assistant"
      environment = "prod"
      managed_by  = "terraform"
    },
    var.labels
  )

  required_apis = toset([
    "cloudbilling.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])

  runtime_secret_names = toset([
    "FA_INTERNAL_AUTH_TOKEN",
    "FA_INTERNAL_AUTH_TOKEN_PREVIOUS",
    "FA_SITE_BASIC_AUTH_USER",
    "FA_SITE_BASIC_AUTH_HTPASSWD",
    "FA_SITE_BASIC_AUTH_CHECK_HEADER",
    "FA_AUTH0_ISSUER",
    "FA_AUTH0_JWKS_URI",
    "FA_BOOTSTRAP_ADMIN_EMAILS",
    "FA_DEV_OPENROUTER_APP_API_KEY",
    "FA_DEV_MINIMAX_APP_API_KEY",
    "FA_OPENROUTER_APP_API_KEY",
    "FA_OPENAI_APP_API_KEY",
    "FA_PROD_OPENROUTER_APP_API_KEY",
    "FA_PROD_MINIMAX_APP_API_KEY",
    "FA_GEMINI_APP_API_KEY",
  ])

  provisioning_secret_names = toset([
    "FA_CLOUDFLARE_DNS_API_TOKEN",
    "FA_GRAFANA_LOKI_URL",
    "FA_GRAFANA_LOKI_USERNAME",
    "FA_GRAFANA_LOKI_TOKEN",
    "FA_ALERT_ROUTER_WEBHOOK_SECRET",
    "FA_ALERT_ROUTER_GITHUB_TOKEN",
  ])
}

moved {
  from = google_secret_manager_secret.runtime["FA_CLOUDFLARE_DNS_API_TOKEN"]
  to   = google_secret_manager_secret.provisioning["FA_CLOUDFLARE_DNS_API_TOKEN"]
}

moved {
  from = google_secret_manager_secret_iam_member.provisioner_secret_accessor["FA_CLOUDFLARE_DNS_API_TOKEN"]
  to   = google_secret_manager_secret_iam_member.provisioner_provisioning_secret_accessor["FA_CLOUDFLARE_DNS_API_TOKEN"]
}

moved {
  from = google_secret_manager_secret.runtime["FA_GRAFANA_LOKI_URL"]
  to   = google_secret_manager_secret.provisioning["FA_GRAFANA_LOKI_URL"]
}

moved {
  from = google_secret_manager_secret.runtime["FA_GRAFANA_LOKI_USERNAME"]
  to   = google_secret_manager_secret.provisioning["FA_GRAFANA_LOKI_USERNAME"]
}

moved {
  from = google_secret_manager_secret.runtime["FA_GRAFANA_LOKI_TOKEN"]
  to   = google_secret_manager_secret.provisioning["FA_GRAFANA_LOKI_TOKEN"]
}

moved {
  from = google_secret_manager_secret.runtime["FA_ALERT_ROUTER_WEBHOOK_SECRET"]
  to   = google_secret_manager_secret.provisioning["FA_ALERT_ROUTER_WEBHOOK_SECRET"]
}

moved {
  from = google_secret_manager_secret.runtime["FA_ALERT_ROUTER_GITHUB_TOKEN"]
  to   = google_secret_manager_secret.provisioning["FA_ALERT_ROUTER_GITHUB_TOKEN"]
}

moved {
  from = google_secret_manager_secret_iam_member.provisioner_secret_accessor["FA_GRAFANA_LOKI_URL"]
  to   = google_secret_manager_secret_iam_member.provisioner_provisioning_secret_accessor["FA_GRAFANA_LOKI_URL"]
}

moved {
  from = google_secret_manager_secret_iam_member.provisioner_secret_accessor["FA_GRAFANA_LOKI_USERNAME"]
  to   = google_secret_manager_secret_iam_member.provisioner_provisioning_secret_accessor["FA_GRAFANA_LOKI_USERNAME"]
}

moved {
  from = google_secret_manager_secret_iam_member.provisioner_secret_accessor["FA_GRAFANA_LOKI_TOKEN"]
  to   = google_secret_manager_secret_iam_member.provisioner_provisioning_secret_accessor["FA_GRAFANA_LOKI_TOKEN"]
}

moved {
  from = google_secret_manager_secret_iam_member.provisioner_secret_accessor["FA_ALERT_ROUTER_WEBHOOK_SECRET"]
  to   = google_secret_manager_secret_iam_member.provisioner_provisioning_secret_accessor["FA_ALERT_ROUTER_WEBHOOK_SECRET"]
}

moved {
  from = google_secret_manager_secret_iam_member.provisioner_secret_accessor["FA_ALERT_ROUTER_GITHUB_TOKEN"]
  to   = google_secret_manager_secret_iam_member.provisioner_provisioning_secret_accessor["FA_ALERT_ROUTER_GITHUB_TOKEN"]
}

resource "google_project_service" "required" {
  for_each = local.required_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "automation_admin" {
  project      = var.project_id
  account_id   = "fa-admin"
  display_name = "Fishing Assistant Admin"
  description  = "Automation service account for Fishing Assistant infrastructure and deployments."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "hetzner_provisioner" {
  project      = var.project_id
  account_id   = "fa-hetzner-provisioner"
  display_name = "FA Hetzner provisioner"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "hetzner_runtime" {
  project      = var.project_id
  account_id   = "fa-hetzner-runtime"
  display_name = "FA Hetzner runtime"

  depends_on = [google_project_service.required]
}

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "firestore_backups" {
  project                     = var.project_id
  name                        = var.firestore_backup_bucket
  location                    = "EU"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.common_labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "shared_content" {
  project                     = var.project_id
  name                        = var.shared_content_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"
  labels                      = local.common_labels

  website {
    main_page_suffix = "index.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.runtime_secret_names

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "provisioning" {
  for_each = local.provisioning_secret_names

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = local.common_labels

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "runtime_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"
}

resource "google_project_iam_member" "automation_admin_service_account_key_admin" {
  project = var.project_id
  role    = "roles/iam.serviceAccountKeyAdmin"
  member  = "serviceAccount:${google_service_account.automation_admin.email}"
}

resource "google_storage_bucket_iam_member" "shared_content_public_read" {
  bucket = google_storage_bucket.shared_content.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

resource "google_storage_bucket_iam_member" "automation_admin_shared_content_object_admin" {
  bucket = google_storage_bucket.shared_content.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.automation_admin.email}"
}

resource "google_secret_manager_secret_iam_member" "provisioner_secret_accessor" {
  for_each = google_secret_manager_secret.runtime

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_secret_manager_secret_iam_member" "provisioner_provisioning_secret_accessor" {
  for_each = google_secret_manager_secret.provisioning

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

resource "google_storage_bucket_iam_member" "runtime_backup_writer" {
  bucket = google_storage_bucket.firestore_backups.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.hetzner_provisioner.email}"
}

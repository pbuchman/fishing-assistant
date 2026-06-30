terraform {
  required_version = ">= 1.8.0"

  backend "gcs" {
    bucket = "replace-with-terraform-state-bucket"
    prefix = "terraform/state/gcp-data-plane"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

terraform {
  required_version = ">= 1.8.0"

  backend "gcs" {
    bucket = "replace-with-terraform-state-bucket"
    prefix = "terraform/state/hetzner-prod"
  }

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}

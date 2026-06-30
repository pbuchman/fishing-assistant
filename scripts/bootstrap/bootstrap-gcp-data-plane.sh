#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TERRAFORM_DIR="${REPO_ROOT}/terraform/gcp-data-plane"

FA_GCP_PROJECT_ID="${FA_GCP_PROJECT_ID:-replace-with-gcp-project-id}"
FA_GCP_REGION="${FA_GCP_REGION:-europe-central2}"
FA_GCP_ADMIN_SERVICE_ACCOUNT="${FA_GCP_ADMIN_SERVICE_ACCOUNT:-replace-with-admin-service-account}"
FA_GCP_ADMIN_KEY_FILE="${FA_GCP_ADMIN_KEY_FILE:-${HOME}/.config/gcloud/fa-admin-key.json}"
FA_TERRAFORM_STATE_BUCKET="${FA_TERRAFORM_STATE_BUCKET:-replace-with-terraform-state-bucket}"
RUN_TERRAFORM_APPLY=0
RUN_MIGRATIONS=0

REQUIRED_APIS=(
  cloudbilling.googleapis.com
  cloudresourcemanager.googleapis.com
  firestore.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
  secretmanager.googleapis.com
  serviceusage.googleapis.com
  storage.googleapis.com
)

usage() {
  printf 'Usage: %s [--apply] [--migrate]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --apply)
        RUN_TERRAFORM_APPLY=1
        shift
        ;;
      --migrate)
        RUN_MIGRATIONS=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
}

gcloud_fa() {
  gcloud \
    --account="${FA_GCP_ADMIN_SERVICE_ACCOUNT}" \
    --project="${FA_GCP_PROJECT_ID}" \
    "$@"
}

activate_service_account() {
  [[ -r "${FA_GCP_ADMIN_KEY_FILE}" ]] || fail "FA admin key is not readable: ${FA_GCP_ADMIN_KEY_FILE}"
  gcloud auth activate-service-account "${FA_GCP_ADMIN_SERVICE_ACCOUNT}" \
    --key-file="${FA_GCP_ADMIN_KEY_FILE}" \
    --project="${FA_GCP_PROJECT_ID}" >/dev/null
}

enable_apis() {
  local api=""
  for api in "${REQUIRED_APIS[@]}"; do
    printf 'Enabling %s\n' "${api}"
    gcloud_fa services enable "${api}"
  done
}

ensure_state_bucket() {
  if gcloud_fa storage buckets describe "gs://${FA_TERRAFORM_STATE_BUCKET}" >/dev/null 2>&1; then
    printf 'Terraform state bucket exists: gs://%s\n' "${FA_TERRAFORM_STATE_BUCKET}"
    return
  fi

  gcloud_fa storage buckets create "gs://${FA_TERRAFORM_STATE_BUCKET}" \
    --location=EU \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --soft-delete-duration=7d
}

run_terraform() {
  export GOOGLE_APPLICATION_CREDENTIALS="${FA_GCP_ADMIN_KEY_FILE}"
  export GOOGLE_CLOUD_PROJECT="${FA_GCP_PROJECT_ID}"
  export GCLOUD_PROJECT="${FA_GCP_PROJECT_ID}"
  export CLOUDSDK_CORE_PROJECT="${FA_GCP_PROJECT_ID}"
  export CLOUDSDK_COMPUTE_REGION="${FA_GCP_REGION}"

  terraform -chdir="${TERRAFORM_DIR}" init
  terraform -chdir="${TERRAFORM_DIR}" validate

  if [[ "${RUN_TERRAFORM_APPLY}" -eq 1 ]]; then
    terraform -chdir="${TERRAFORM_DIR}" apply
  else
    terraform -chdir="${TERRAFORM_DIR}" plan
  fi
}

run_migrations() {
  if [[ "${RUN_MIGRATIONS}" -ne 1 ]]; then
    pnpm run migrate:status
    return
  fi

  pnpm run migrate
}

main() {
  parse_args "$@"
  require_command gcloud
  require_command terraform
  require_command pnpm

  cd "${REPO_ROOT}"
  activate_service_account
  enable_apis
  ensure_state_bucket
  run_terraform
  run_migrations
}

main "$@"

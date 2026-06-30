#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

FA_GCP_PROJECT_ID="${FA_GCP_PROJECT_ID:-replace-with-gcp-project-id}"
FA_FIRESTORE_BACKUP_BUCKET="${FA_FIRESTORE_BACKUP_BUCKET:-replace-with-firestore-backup-bucket}"
FA_GCP_ADMIN_SERVICE_ACCOUNT="${FA_GCP_ADMIN_SERVICE_ACCOUNT:-replace-with-admin-service-account}"
FA_GCP_ADMIN_KEY_FILE="${FA_GCP_ADMIN_KEY_FILE:-${HOME}/.config/gcloud/fa-admin-key.json}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

gcloud_fa() {
  gcloud \
    --account="${FA_GCP_ADMIN_SERVICE_ACCOUNT}" \
    --project="${FA_GCP_PROJECT_ID}" \
    "$@"
}

main() {
  command -v gcloud >/dev/null 2>&1 || fail "gcloud is required"
  [[ -r "${FA_GCP_ADMIN_KEY_FILE}" ]] || fail "FA admin key is not readable: ${FA_GCP_ADMIN_KEY_FILE}"

  gcloud auth activate-service-account "${FA_GCP_ADMIN_SERVICE_ACCOUNT}" \
    --key-file="${FA_GCP_ADMIN_KEY_FILE}" \
    --project="${FA_GCP_PROJECT_ID}" >/dev/null

  gcloud_fa firestore export "gs://${FA_FIRESTORE_BACKUP_BUCKET}/exports/${TIMESTAMP}"
  printf 'Started Firestore export to gs://%s/exports/%s\n' "${FA_FIRESTORE_BACKUP_BUCKET}" "${TIMESTAMP}"
}

main "$@"

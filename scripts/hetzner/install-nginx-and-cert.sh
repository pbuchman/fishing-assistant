#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

DOMAIN="${DOMAIN:-fishing-assistant.online}"
FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"
FA_GCP_PROJECT_ID="${FA_GCP_PROJECT_ID:-replace-with-gcp-project-id}"
FA_HETZNER_PROVISIONER_KEY_FILE="${FA_HETZNER_PROVISIONER_KEY_FILE:-/etc/fa/keys/provisioner-sa-key.json}"
CLOUDFLARE_CREDENTIALS_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
CLOUDFLARE_DNS_API_TOKEN_SECRET="${CLOUDFLARE_DNS_API_TOKEN_SECRET:-FA_CLOUDFLARE_DNS_API_TOKEN}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SKIP_CERTBOT=0

usage() {
  printf 'Usage: FA_ENVIRONMENT=prod %s --email ops@example.com [--skip-certbot]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_prod() {
  [[ "${FA_ENVIRONMENT}" == "prod" ]] || fail "FA_ENVIRONMENT must be prod"
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Run this script as root"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email)
        shift
        [[ $# -gt 0 ]] || fail "--email requires a value"
        CERTBOT_EMAIL="$1"
        shift
        ;;
      --email=*)
        CERTBOT_EMAIL="${1#*=}"
        shift
        ;;
      --skip-certbot)
        SKIP_CERTBOT=1
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

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    certbot \
    nginx \
    python3-certbot-dns-cloudflare
}

read_secret_value() {
  gcloud secrets versions access latest \
    --secret="$1" \
    --project="${FA_GCP_PROJECT_ID}"
}

write_cloudflare_credentials() {
  local token=""
  local temp_file=""

  command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is required"
  [[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] ||
    fail "Provisioner service-account key is required: ${FA_HETZNER_PROVISIONER_KEY_FILE}"
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"

  token="$(read_secret_value "${CLOUDFLARE_DNS_API_TOKEN_SECRET}")"
  [[ -n "${token}" ]] || fail "${CLOUDFLARE_DNS_API_TOKEN_SECRET} returned an empty value"

  umask 077
  temp_file="$(mktemp "${TMPDIR:-/tmp}/fa-cloudflare.XXXXXX")"
  printf 'dns_cloudflare_api_token = %s\n' "${token}" > "${temp_file}"
  install -d -m 700 "$(dirname "${CLOUDFLARE_CREDENTIALS_FILE}")"
  install -m 600 "${temp_file}" "${CLOUDFLARE_CREDENTIALS_FILE}"
  rm -f "${temp_file}"
}

request_certificate() {
  if [[ "${SKIP_CERTBOT}" -eq 1 ]]; then
    return
  fi

  [[ -n "${CERTBOT_EMAIL}" ]] || fail "--email or CERTBOT_EMAIL is required"

  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "${CLOUDFLARE_CREDENTIALS_FILE}" \
    --dns-cloudflare-propagation-seconds 60 \
    --domain "${DOMAIN}" \
    --agree-tos \
    --email "${CERTBOT_EMAIL}" \
    --keep-until-expiring \
    --non-interactive
}

install_renewal_hook() {
  install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/fa-nginx-reload.sh <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
systemctl reload nginx
HOOK
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/fa-nginx-reload.sh
}

main() {
  parse_args "$@"
  require_prod
  require_root
  install_packages
  write_cloudflare_credentials
  request_certificate
  install_renewal_hook
  systemctl enable --now nginx
  systemctl enable --now certbot.timer || true
}

main "$@"

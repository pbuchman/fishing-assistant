#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"
if [[ -f /etc/fa/project.env ]]; then
  # shellcheck disable=SC1091
  . /etc/fa/project.env
fi
FA_GCP_PROJECT_ID="${FA_GCP_PROJECT_ID:-replace-with-gcp-project-id}"
FA_GCP_REGION="${FA_GCP_REGION:-europe-central2}"
FA_LOG_LEVEL="${FA_LOG_LEVEL:-info}"
FA_AUTH0_DOMAIN="${FA_AUTH0_DOMAIN:-}"
FA_AUTH0_CLIENT_ID="${FA_AUTH0_CLIENT_ID:-}"
FA_AUTH0_AUDIENCE="${FA_AUTH0_AUDIENCE:-}"
FA_PROD_ENV_FILE="${FA_PROD_ENV_FILE:-/etc/fa/.env.prod}"
FA_HETZNER_PROVISIONER_KEY_FILE="${FA_HETZNER_PROVISIONER_KEY_FILE:-/etc/fa/keys/provisioner-sa-key.json}"
runtime_sa_key_file="/run/secrets/fa-runtime-sa-key.json"
deploy_user="deploy"
temp_env_file=""
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

FA_RUNTIME_SECRET_BINDINGS=(
  FA_INTERNAL_AUTH_TOKEN=FA_INTERNAL_AUTH_TOKEN
  FA_AUTH0_ISSUER=FA_AUTH0_ISSUER
  FA_AUTH0_JWKS_URI=FA_AUTH0_JWKS_URI
  FA_BOOTSTRAP_ADMIN_EMAILS=FA_BOOTSTRAP_ADMIN_EMAILS
  FA_SIGNUP_ALLOWED_EMAIL_PATTERN=FA_SIGNUP_ALLOWED_EMAIL_PATTERN
  FA_PROD_OPENROUTER_APP_API_KEY=FA_OPENROUTER_APP_API_KEY
  FA_PROD_MINIMAX_APP_API_KEY=FA_MINIMAX_APP_API_KEY
  FA_OPENAI_APP_API_KEY=FA_OPENAI_APP_API_KEY
  FA_GEMINI_APP_API_KEY=FA_GEMINI_APP_API_KEY
)

FA_OPTIONAL_RUNTIME_SECRETS=(
  FA_INTERNAL_AUTH_TOKEN_PREVIOUS
)

FA_SITE_BASIC_AUTH_SECRETS=(
  FA_SITE_BASIC_AUTH_USER
  FA_SITE_BASIC_AUTH_HTPASSWD
  FA_SITE_BASIC_AUTH_CHECK_HEADER
)

FA_PUBLIC_RUNTIME_CONFIG=(
  FA_AUTH0_DOMAIN
  FA_AUTH0_CLIENT_ID
  FA_AUTH0_AUDIENCE
)

usage() {
  printf 'Usage: FA_ENVIRONMENT=prod %s --auth0-domain value --auth0-client-id value --auth0-audience value [--output path]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup_temp_file() {
  [[ -n "${temp_env_file:-}" ]] && rm -f "${temp_env_file}"
}

require_prod() {
  [[ "${FA_ENVIRONMENT}" == "prod" ]] || fail "FA_ENVIRONMENT must be prod"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)
        shift
        [[ $# -gt 0 ]] || fail "--output requires a value"
        FA_PROD_ENV_FILE="$1"
        shift
        ;;
      --output=*)
        FA_PROD_ENV_FILE="${1#*=}"
        shift
        ;;
      --auth0-domain)
        shift
        [[ $# -gt 0 ]] || fail "--auth0-domain requires a value"
        FA_AUTH0_DOMAIN="$1"
        shift
        ;;
      --auth0-domain=*)
        FA_AUTH0_DOMAIN="${1#*=}"
        shift
        ;;
      --auth0-client-id)
        shift
        [[ $# -gt 0 ]] || fail "--auth0-client-id requires a value"
        FA_AUTH0_CLIENT_ID="$1"
        shift
        ;;
      --auth0-client-id=*)
        FA_AUTH0_CLIENT_ID="${1#*=}"
        shift
        ;;
      --auth0-audience)
        shift
        [[ $# -gt 0 ]] || fail "--auth0-audience requires a value"
        FA_AUTH0_AUDIENCE="$1"
        shift
        ;;
      --auth0-audience=*)
        FA_AUTH0_AUDIENCE="${1#*=}"
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

is_placeholder_value() {
  [[ "$1" == replace-with-* ]]
}

assign_public_runtime_config_value() {
  local key="$1"
  local value="$2"

  [[ -n "${value}" ]] || fail "Missing public runtime config ${key}"
  ! is_placeholder_value "${value}" || fail "Public runtime config ${key} still contains a placeholder value"

  case "${key}" in
    FA_AUTH0_DOMAIN)
      FA_AUTH0_DOMAIN="${value}"
      ;;
    FA_AUTH0_CLIENT_ID)
      FA_AUTH0_CLIENT_ID="${value}"
      ;;
    FA_AUTH0_AUDIENCE)
      FA_AUTH0_AUDIENCE="${value}"
      ;;
    *)
      fail "Unsupported public runtime config key: ${key}"
      ;;
  esac
}

load_public_runtime_config_file() {
  local config_file="${repo_root}/.fa-public-runtime.env"
  local real_config_file=""
  local expected_config_file=""
  local line=""
  local key=""
  local value=""

  [[ -f "${config_file}" ]] || return

  real_config_file="$(realpath -e "${config_file}")" ||
    fail "Unable to resolve public runtime config file: ${config_file}"
  expected_config_file="${repo_root}/.fa-public-runtime.env"
  [[ "${real_config_file}" == "${expected_config_file}" ]] ||
    fail "Public runtime config file must be ${expected_config_file}"

  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -n "${line}" && "${line}" != \#* ]] || continue
    [[ "${line}" == *=* ]] || fail "Invalid public runtime config line: ${line}"

    key="${line%%=*}"
    value="${line#*=}"
    assign_public_runtime_config_value "${key}" "${value}"
  done < "${real_config_file}"
}

load_missing_public_runtime_config() {
  if [[ -n "${FA_AUTH0_DOMAIN}" && -n "${FA_AUTH0_CLIENT_ID}" && -n "${FA_AUTH0_AUDIENCE}" ]]; then
    return
  fi

  load_public_runtime_config_file
}

dotenv_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '"%s"' "${value}"
}

write_env_line() {
  local output_path="$1"
  local key="$2"
  local value="$3"
  printf '%s=%s\n' "${key}" "$(dotenv_escape "${value}")" >> "${output_path}"
}

write_static_env() {
  local output_path="$1"

  cat > "${output_path}" <<'HEADER'
# Generated by scripts/hetzner/load-secrets.sh.
# Do not edit by hand. Secrets are sourced from GCP Secret Manager.
HEADER

  write_env_line "${output_path}" FA_ENVIRONMENT prod
  write_env_line "${output_path}" FA_DATA_PLANE gcp
  write_env_line "${output_path}" FA_BIND_HOST 0.0.0.0
  write_env_line "${output_path}" FA_GCP_PROJECT_ID "${FA_GCP_PROJECT_ID}"
  write_env_line "${output_path}" FA_GCP_REGION "${FA_GCP_REGION}"
  write_env_line "${output_path}" FA_PUBLIC_ORIGIN https://fishing-assistant.online
  write_env_line "${output_path}" FA_WEB_APP_URL https://fishing-assistant.online
  write_env_line "${output_path}" FA_CHAT_SERVICE_URL /api/chat
  write_env_line "${output_path}" FA_KNOWLEDGE_SERVICE_URL /api/knowledge
  write_env_line "${output_path}" FA_LLM_USAGE_SERVICE_URL /api/llm-usage
  write_env_line "${output_path}" FA_USER_SERVICE_URL /api/users
  write_env_line "${output_path}" FA_CHAT_SERVICE_INTERNAL_URL http://127.0.0.1:3201
  write_env_line "${output_path}" FA_KNOWLEDGE_SERVICE_INTERNAL_URL http://127.0.0.1:3202
  write_env_line "${output_path}" FA_LLM_USAGE_SERVICE_INTERNAL_URL http://127.0.0.1:3203
  write_env_line "${output_path}" FA_USER_SERVICE_INTERNAL_URL http://127.0.0.1:3204
  write_env_line "${output_path}" FA_EMBEDDING_PROVIDER "${FA_EMBEDDING_PROVIDER:-openrouter}"
  write_env_line "${output_path}" FA_EMBEDDING_MODEL "${FA_EMBEDDING_MODEL:-qwen/qwen3-embedding-8b}"
  write_env_line "${output_path}" FA_EMBEDDING_DIMENSIONS "${FA_EMBEDDING_DIMENSIONS:-2048}"
  write_env_line "${output_path}" FA_LOG_LEVEL "${FA_LOG_LEVEL}"
  write_env_line "${output_path}" GOOGLE_APPLICATION_CREDENTIALS "${runtime_sa_key_file}"
  write_env_line "${output_path}" GOOGLE_CLOUD_PROJECT "${FA_GCP_PROJECT_ID}"
  write_env_line "${output_path}" GCLOUD_PROJECT "${FA_GCP_PROJECT_ID}"
  write_env_line "${output_path}" CLOUDSDK_CORE_PROJECT "${FA_GCP_PROJECT_ID}"
  write_env_line "${output_path}" CLOUDSDK_COMPUTE_REGION "${FA_GCP_REGION}"
}

write_public_runtime_config() {
  local output_path="$1"
  local config_name=""
  local config_value=""

  for config_name in "${FA_PUBLIC_RUNTIME_CONFIG[@]}"; do
    config_value="${!config_name:-}"
    [[ -n "${config_value}" ]] || fail "Missing public runtime config ${config_name}"
    ! is_placeholder_value "${config_value}" || fail "Public runtime config ${config_name} still contains a placeholder value"
    write_env_line "${output_path}" "${config_name}" "${config_value}"
  done
}

validate_secret_name() {
  local secret_name="$1"
  [[ "${secret_name}" =~ ^FA_[A-Z0-9_]+$ ]] || fail "Invalid FA Secret Manager name: ${secret_name}"
}

read_secret() {
  local secret_name="$1"
  gcloud secrets versions access latest \
    --secret="${secret_name}" \
    --project="${FA_GCP_PROJECT_ID}"
}

append_secret() {
  local output_path="$1"
  local secret_name="$2"
  local secret_value=""

  validate_secret_name "${secret_name}"
  printf 'Loading secret %s\n' "${secret_name}" >&2
  secret_value="$(read_secret "${secret_name}")" || fail "Unable to read ${secret_name}"
  write_env_line "${output_path}" "${secret_name}" "${secret_value}"
}

append_secret_as() {
  local output_path="$1"
  local source_secret_name="$2"
  local target_env_name="$3"
  local secret_value=""

  validate_secret_name "${source_secret_name}"
  validate_secret_name "${target_env_name}"
  printf 'Loading secret %s as %s\n' "${source_secret_name}" "${target_env_name}" >&2
  secret_value="$(read_secret "${source_secret_name}")" ||
    fail "Unable to read ${source_secret_name}"
  write_env_line "${output_path}" "${target_env_name}" "${secret_value}"
}

append_optional_secret() {
  local output_path="$1"
  local secret_name="$2"
  local secret_value=""

  validate_secret_name "${secret_name}"
  printf 'Loading optional secret %s\n' "${secret_name}" >&2
  if secret_value="$(read_secret "${secret_name}" 2>/dev/null)"; then
    write_env_line "${output_path}" "${secret_name}" "${secret_value}"
    return
  fi

  write_env_line "${output_path}" "${secret_name}" ""
}

install_site_basic_auth_files() {
  local output_path="$1"
  local release_dir=""
  local auth_dir=""
  local htpasswd_value=""
  local check_header_value=""

  case "${output_path}" in
    "${repo_root}/"*) ;;
    *) return ;;
  esac

  for secret_name in "${FA_SITE_BASIC_AUTH_SECRETS[@]}"; do
    validate_secret_name "${secret_name}"
  done

  release_dir="${repo_root}"
  auth_dir="${release_dir}/.fa"
  install -d -m 755 "${auth_dir}"

  htpasswd_value="$(read_secret FA_SITE_BASIC_AUTH_HTPASSWD)" ||
    fail "Unable to read FA_SITE_BASIC_AUTH_HTPASSWD"
  check_header_value="$(read_secret FA_SITE_BASIC_AUTH_CHECK_HEADER)" ||
    fail "Unable to read FA_SITE_BASIC_AUTH_CHECK_HEADER"

  printf '%s\n' "${htpasswd_value}" > "${auth_dir}/site-basic-auth.htpasswd.tmp"
  install -m 644 "${auth_dir}/site-basic-auth.htpasswd.tmp" "${auth_dir}/site-basic-auth.htpasswd"
  rm -f "${auth_dir}/site-basic-auth.htpasswd.tmp"

  printf '%s\n' "${check_header_value}" > "${auth_dir}/site-basic-auth.curl-header.tmp"
  install -m 600 "${auth_dir}/site-basic-auth.curl-header.tmp" "${auth_dir}/site-basic-auth.curl-header"
  rm -f "${auth_dir}/site-basic-auth.curl-header.tmp"
}

install_prod_env_file() {
  local output_dir=""

  if [[ "$(id -u)" -eq 0 ]]; then
    install -d -m 750 -o root -g "${deploy_user}" "$(dirname "${FA_PROD_ENV_FILE}")"
    install -m 640 -o root -g "${deploy_user}" "${temp_env_file}" "${FA_PROD_ENV_FILE}"
    return
  fi

  case "${FA_PROD_ENV_FILE}" in
    "${repo_root}/"*) ;;
    *) fail "Non-root env output must stay under ${repo_root}" ;;
  esac

  output_dir="$(dirname "${FA_PROD_ENV_FILE}")"
  install -d -m 700 "${output_dir}"
  install -m 600 "${temp_env_file}" "${FA_PROD_ENV_FILE}"
}

main() {
  parse_args "$@"
  load_missing_public_runtime_config
  require_prod
  command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is required"
  id -u "${deploy_user}" >/dev/null 2>&1 || fail "Deploy user ${deploy_user} is required"

  [[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] ||
    fail "Provisioner service-account key is required: ${FA_HETZNER_PROVISIONER_KEY_FILE}"
  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"

  umask 077
  temp_env_file="$(mktemp "${TMPDIR:-/tmp}/fa-prod-env.XXXXXX")"
  trap cleanup_temp_file EXIT

  write_static_env "${temp_env_file}"
  write_public_runtime_config "${temp_env_file}"
  for secret_binding in "${FA_RUNTIME_SECRET_BINDINGS[@]}"; do
    append_secret_as "${temp_env_file}" "${secret_binding%%=*}" "${secret_binding#*=}"
  done
  for secret_name in "${FA_OPTIONAL_RUNTIME_SECRETS[@]}"; do
    append_optional_secret "${temp_env_file}" "${secret_name}"
  done

  install_site_basic_auth_files "${FA_PROD_ENV_FILE}"
  install_prod_env_file
  printf 'Wrote %s with %s required and %s optional Secret Manager values\n' \
    "${FA_PROD_ENV_FILE}" \
    "${#FA_RUNTIME_SECRET_BINDINGS[@]}" \
    "${#FA_OPTIONAL_RUNTIME_SECRETS[@]}"
}

main "$@"

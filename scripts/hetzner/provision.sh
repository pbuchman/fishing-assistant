#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

deploy_user="deploy"
app_root="/opt/fishing-assistant"
web_root="/var/www/fa"
FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"
swap_file="/swapfile"
swap_size="4G"

usage() {
  printf 'Usage: FA_ENVIRONMENT=prod %s\n' "$(basename "$0")"
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

install_base_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    certbot \
    curl \
    docker.io \
    fail2ban \
    git \
    gnupg \
    jq \
    nginx \
    python3-certbot-dns-cloudflare \
    rsync \
    sudo \
    ufw
}

install_google_cloud_cli() {
  if command -v gcloud >/dev/null 2>&1; then
    return
  fi

  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  printf 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main\n' \
    > /etc/apt/sources.list.d/google-cloud-sdk.list

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y google-cloud-cli
}

install_node_22() {
  if command -v node >/dev/null 2>&1 && [[ "$(node --version)" == v22.* ]]; then
    corepack enable
    return
  fi

  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  corepack enable
}

ensure_swap() {
  if swapon --show=NAME --noheadings | awk '{ print $1 }' | grep -Fxq "${swap_file}"; then
    return
  fi

  if [[ ! -f "${swap_file}" ]]; then
    fallocate -l "${swap_size}" "${swap_file}"
    chmod 600 "${swap_file}"
    mkswap "${swap_file}"
  fi

  swapon "${swap_file}"
  grep -q "^${swap_file} " /etc/fstab || printf '%s none swap sw 0 0\n' "${swap_file}" >> /etc/fstab
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-fa-swap.conf
  sysctl --system >/dev/null
}

prepare_user_and_directories() {
  if ! id -u "${deploy_user}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${deploy_user}"
  fi

  usermod -aG docker "${deploy_user}"
  gpasswd -d "${deploy_user}" sudo >/dev/null 2>&1 || true

  install -d -o "${deploy_user}" -g "${deploy_user}" -m 755 "${app_root}" "${app_root}/releases"
  install -d -o "${deploy_user}" -g "${deploy_user}" -m 755 "${web_root}" "${web_root}/releases"
  install -d -o root -g "${deploy_user}" -m 750 /etc/fa /etc/fa/keys /etc/fa/alloy
  if [[ ! -e /etc/fa/observability.env ]]; then
    install -o root -g "${deploy_user}" -m 0640 /dev/null /etc/fa/observability.env
  else
    local current_mode=""
    chown root:"${deploy_user}" /etc/fa/observability.env
    current_mode="$(stat -c '%a' /etc/fa/observability.env)"
    case "${current_mode}" in
      400|0400|600|0600|640|0640) ;;
      *) chmod 0640 /etc/fa/observability.env ;;
    esac
  fi
  install -d -o root -g root -m 755 /var/log/fa
}

install_deploy_wrappers() {
  install -d -o root -g root -m 755 /usr/local/sbin

  cat > /usr/local/sbin/fa-load-secrets <<'WRAPPER'
#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

app_root="/opt/fishing-assistant"
if [[ -f /etc/fa/project.env ]]; then
  # shellcheck disable=SC1091
  . /etc/fa/project.env
fi
FA_GCP_PROJECT_ID="${FA_GCP_PROJECT_ID:-replace-with-gcp-project-id}"
FA_GCP_REGION="europe-central2"
FA_LOG_LEVEL="info"
FA_AUTH0_DOMAIN="${FA_AUTH0_DOMAIN:-}"
FA_AUTH0_CLIENT_ID="${FA_AUTH0_CLIENT_ID:-}"
FA_AUTH0_AUDIENCE="${FA_AUTH0_AUDIENCE:-}"
FA_PROD_ENV_FILE="/etc/fa/.env.prod"
FA_HETZNER_PROVISIONER_KEY_FILE="/etc/fa/keys/provisioner-sa-key.json"
runtime_sa_key_file="/run/secrets/fa-runtime-sa-key.json"
deploy_user="deploy"
temp_env_file=""
release_arg=""

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

FA_PUBLIC_RUNTIME_CONFIG=(
  FA_AUTH0_DOMAIN
  FA_AUTH0_CLIENT_ID
  FA_AUTH0_AUDIENCE
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup_temp_file() {
  [[ -n "${temp_env_file:-}" ]] && rm -f "${temp_env_file}"
}

is_placeholder_value() {
  [[ "$1" == replace-with-* ]]
}

parse_args() {
  release_arg=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
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
      -*)
        fail "Unknown argument: $1"
        ;;
      *)
        [[ -z "${release_arg}" ]] || fail "Only one release directory argument is allowed"
        release_arg="$1"
        shift
        ;;
    esac
  done

  [[ -n "${release_arg}" ]] || fail "Usage: fa-load-secrets --auth0-domain value --auth0-client-id value --auth0-audience value <release-or-current-dir>"
}

canonical_release_dir() {
  local input_dir="${1%/}"
  local release_dir=""
  local release_name=""

  [[ -n "${input_dir}" ]] || fail "Release directory is required"
  case "${input_dir}" in
    "${app_root}/current"|"${app_root}/releases/"*) ;;
    *) fail "Release directory must be ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  release_dir="$(realpath -e "${input_dir}")" || fail "Release directory does not exist: ${input_dir}"
  case "${release_dir}" in
    "${app_root}/current") ;;
    "${app_root}/releases/"*)
      release_name="${release_dir#"${app_root}/releases/"}"
      [[ -n "${release_name}" && "${release_name}" != */* ]] ||
        fail "Release directory must resolve to ${app_root}/releases/<sha>"
      ;;
    *) fail "Release directory resolved outside ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  [[ -d "${release_dir}" ]] || fail "Release path is not a directory: ${release_dir}"
  printf '%s\n' "${release_dir}"
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
# Generated by /usr/local/sbin/fa-load-secrets.
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
  write_env_line "${output_path}" FA_EMBEDDING_PROVIDER openrouter
  write_env_line "${output_path}" FA_EMBEDDING_MODEL qwen/qwen3-embedding-8b
  write_env_line "${output_path}" FA_EMBEDDING_DIMENSIONS 2048
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

main() {
  local release_dir=""

  parse_args "$@"
  release_dir="$(canonical_release_dir "${release_arg}")"
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

  install -d -m 750 -o root -g "${deploy_user}" "$(dirname "${FA_PROD_ENV_FILE}")"
  install -m 640 -o root -g "${deploy_user}" "${temp_env_file}" "${FA_PROD_ENV_FILE}"
  printf 'Wrote %s with %s required and %s optional Secret Manager values\n' \
    "${FA_PROD_ENV_FILE}" \
    "${#FA_RUNTIME_SECRET_BINDINGS[@]}" \
    "${#FA_OPTIONAL_RUNTIME_SECRETS[@]}"
}

main "$@"
WRAPPER

  cat > /usr/local/sbin/fa-deploy-nginx <<'WRAPPER'
#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

app_root="/opt/fishing-assistant"
site_target="/etc/nginx/sites-available/fishing-assistant.conf"
site_enabled="/etc/nginx/sites-enabled/fishing-assistant.conf"
RELOAD_NGINX=1
NGINX_MODE="https"
NGINX_SOURCE_RELATIVE="scripts/hetzner/nginx/fishing-assistant.conf"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

canonical_release_dir() {
  local input_dir="${1%/}"
  local release_dir=""
  local release_name=""

  [[ -n "${input_dir}" ]] || fail "Release directory is required"
  case "${input_dir}" in
    "${app_root}/current"|"${app_root}/releases/"*) ;;
    *) fail "Release directory must be ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  release_dir="$(realpath -e "${input_dir}")" || fail "Release directory does not exist: ${input_dir}"
  case "${release_dir}" in
    "${app_root}/current") ;;
    "${app_root}/releases/"*)
      release_name="${release_dir#"${app_root}/releases/"}"
      [[ -n "${release_name}" && "${release_name}" != */* ]] ||
        fail "Release directory must resolve to ${app_root}/releases/<sha>"
      ;;
    *) fail "Release directory resolved outside ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  [[ -d "${release_dir}" ]] || fail "Release path is not a directory: ${release_dir}"
  printf '%s\n' "${release_dir}"
}

canonical_nginx_source() {
  local release_dir="$1"
  local relative_path="$2"
  local source_path="${release_dir}/${relative_path}"
  local source_dir="${release_dir}/scripts/hetzner/nginx"
  local real_source=""
  local real_source_dir=""
  local source_name=""

  case "${relative_path}" in
    scripts/hetzner/nginx/fishing-assistant.conf|scripts/hetzner/nginx/fishing-assistant.origin-http.conf) ;;
    *) fail "Unsupported nginx config source: ${relative_path}" ;;
  esac

  real_source="$(realpath -e "${source_path}")" || fail "Missing nginx config source: ${source_path}"
  real_source_dir="$(dirname "${real_source}")"
  source_name="$(basename "${real_source}")"

  [[ "${real_source_dir}" == "${source_dir}" ]] ||
    fail "Nginx config source must resolve under ${source_dir}"

  case "${source_name}" in
    fishing-assistant.conf|fishing-assistant.origin-http.conf) ;;
    *) fail "Unsupported nginx config source basename: ${source_name}" ;;
  esac

  [[ -f "${real_source}" ]] || fail "Nginx config source is not a regular file: ${real_source}"
  printf '%s\n' "${real_source}"
}

reload_nginx() {
  if [[ "${RELOAD_NGINX}" -ne 1 ]]; then
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    nginx -s reload
  fi
}

main() {
  [[ "$#" -ge 1 ]] || fail "Usage: fa-deploy-nginx <release-or-current-dir> [--origin-http-only] [--skip-reload]"

  local release_dir=""
  local nginx_source=""
  release_dir="$(canonical_release_dir "$1")"
  shift

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --origin-http-only)
        NGINX_SOURCE_RELATIVE="scripts/hetzner/nginx/fishing-assistant.origin-http.conf"
        NGINX_MODE="origin-http-only"
        shift
        ;;
      --skip-reload)
        RELOAD_NGINX=0
        shift
        ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done

  command -v nginx >/dev/null 2>&1 || fail "nginx is required"
  nginx_source="$(canonical_nginx_source "${release_dir}" "${NGINX_SOURCE_RELATIVE}")"

  install -d -m 755 "$(dirname "${site_target}")" "$(dirname "${site_enabled}")"
  install -m 644 -o root -g root "${nginx_source}" "${site_target}"
  ln -sfn "${site_target}" "${site_enabled}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  reload_nginx
  printf 'Deployed %s nginx config for fishing-assistant.online\n' "${NGINX_MODE}"
}

main "$@"
WRAPPER

  cat > /usr/local/sbin/fa-load-observability-env <<'WRAPPER'
#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

app_root="/opt/fishing-assistant"
if [[ -f /etc/fa/project.env ]]; then
  # shellcheck disable=SC1091
  . /etc/fa/project.env
fi

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

canonical_release_dir() {
  local input_dir="${1%/}"
  local release_dir=""
  local release_name=""

  [[ -n "${input_dir}" ]] || fail "Release directory is required"
  case "${input_dir}" in
    "${app_root}/current"|"${app_root}/releases/"*) ;;
    *) fail "Release directory must be ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  release_dir="$(realpath -e "${input_dir}")" || fail "Release directory does not exist: ${input_dir}"
  case "${release_dir}" in
    "${app_root}/current") ;;
    "${app_root}/releases/"*)
      release_name="${release_dir#"${app_root}/releases/"}"
      [[ -n "${release_name}" && "${release_name}" != */* ]] ||
        fail "Release directory must resolve to ${app_root}/releases/<sha>"
      ;;
    *) fail "Release directory resolved outside ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  [[ -d "${release_dir}" ]] || fail "Release path is not a directory: ${release_dir}"
  printf '%s\n' "${release_dir}"
}

main() {
  [[ "$#" -eq 4 ]] || fail "Usage: fa-load-observability-env <release-or-current-dir> <grafana-instance-url> <loki-datasource-uid> <alert-router-webhook-url>"

  local release_dir=""
  release_dir="$(canonical_release_dir "$1")"

  FA_ENVIRONMENT=prod \
    FA_GRAFANA_INSTANCE_URL="$2" \
    FA_GRAFANA_LOKI_DATASOURCE_UID="$3" \
    FA_ALERT_ROUTER_WEBHOOK_URL="$4" \
    bash "${release_dir}/scripts/hetzner/load-observability-env.sh"
}

main "$@"
WRAPPER

  cat > /usr/local/sbin/fa-install-observability <<'WRAPPER'
#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

app_root="/opt/fishing-assistant"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

canonical_release_dir() {
  local input_dir="${1%/}"
  local release_dir=""
  local release_name=""

  [[ -n "${input_dir}" ]] || fail "Release directory is required"
  case "${input_dir}" in
    "${app_root}/current"|"${app_root}/releases/"*) ;;
    *) fail "Release directory must be ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  release_dir="$(realpath -e "${input_dir}")" || fail "Release directory does not exist: ${input_dir}"
  case "${release_dir}" in
    "${app_root}/current") ;;
    "${app_root}/releases/"*)
      release_name="${release_dir#"${app_root}/releases/"}"
      [[ -n "${release_name}" && "${release_name}" != */* ]] ||
        fail "Release directory must resolve to ${app_root}/releases/<sha>"
      ;;
    *) fail "Release directory resolved outside ${app_root}/current or ${app_root}/releases/<sha>" ;;
  esac

  [[ -d "${release_dir}" ]] || fail "Release path is not a directory: ${release_dir}"
  printf '%s\n' "${release_dir}"
}

main() {
  [[ "$#" -ge 2 ]] || fail "Usage: fa-install-observability <release-or-current-dir> <git-sha> [--with-alert-router]"

  local release_dir=""
  local deploy_sha="$2"
  local args=()
  release_dir="$(canonical_release_dir "$1")"
  shift 2

  [[ "${deploy_sha}" =~ ^[0-9a-f]{7,64}$ || "${deploy_sha}" == "unknown" ]] ||
    fail "Deploy SHA must be a git SHA or unknown"

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --with-alert-router)
        args+=(--with-alert-router)
        shift
        ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done

  FA_ENVIRONMENT=prod bash "${release_dir}/scripts/hetzner/install-observability.sh" \
    --sha "${deploy_sha}" \
    "${args[@]}"
}

main "$@"
WRAPPER

  chown root:root \
    /usr/local/sbin/fa-load-secrets \
    /usr/local/sbin/fa-deploy-nginx \
    /usr/local/sbin/fa-load-observability-env \
    /usr/local/sbin/fa-install-observability
  chmod 0755 \
    /usr/local/sbin/fa-load-secrets \
    /usr/local/sbin/fa-deploy-nginx \
    /usr/local/sbin/fa-load-observability-env \
    /usr/local/sbin/fa-install-observability

  printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/fa-load-secrets *, /usr/local/sbin/fa-deploy-nginx *, /usr/local/sbin/fa-load-observability-env *, /usr/local/sbin/fa-install-observability *\n' \
    "${deploy_user}" > "/etc/sudoers.d/90-fa-${deploy_user}"
  chmod 0440 "/etc/sudoers.d/90-fa-${deploy_user}"
  visudo -cf "/etc/sudoers.d/90-fa-${deploy_user}" >/dev/null
}

configure_firewall() {
  ufw allow OpenSSH
  ufw allow http
  ufw allow https
  ufw --force enable
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_prod
  require_root
  install_base_packages
  install_google_cloud_cli
  install_node_22
  ensure_swap
  prepare_user_and_directories
  install_deploy_wrappers
  configure_firewall
  systemctl enable --now docker nginx
}

main "$@"

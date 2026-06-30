#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

FA_HETZNER_PROD_HOST="${FA_HETZNER_PROD_HOST:-}"
FA_HETZNER_PROD_HOST_KEY_SHA256="${FA_HETZNER_PROD_HOST_KEY_SHA256:-}"
FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY="${FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY:-}"
FA_PROD_DOMAIN="${FA_PROD_DOMAIN:-fishing-assistant.online}"
FA_GRAFANA_INSTANCE_URL="${FA_GRAFANA_INSTANCE_URL:-https://example.grafana.net}"
FA_GRAFANA_LOKI_DATASOURCE_UID="${FA_GRAFANA_LOKI_DATASOURCE_UID:-grafanacloud-logs}"
FA_ALERT_ROUTER_WEBHOOK_URL="${FA_ALERT_ROUTER_WEBHOOK_URL:-https://${FA_PROD_DOMAIN}/alerts/grafana}"
FA_AUTH0_DOMAIN="${FA_AUTH0_DOMAIN:-}"
FA_AUTH0_CLIENT_ID="${FA_AUTH0_CLIENT_ID:-}"
FA_AUTH0_AUDIENCE="${FA_AUTH0_AUDIENCE:-}"
FA_HETZNER_DEPLOY_USER="${FA_HETZNER_DEPLOY_USER:-deploy}"
FA_HETZNER_RELEASES_DIR="${FA_HETZNER_RELEASES_DIR:-/opt/fishing-assistant/releases}"
FA_HETZNER_CURRENT_DIR="${FA_HETZNER_CURRENT_DIR:-/opt/fishing-assistant/current}"
FA_HETZNER_SSH_PORT="${FA_HETZNER_SSH_PORT:-22}"
deploy_nginx="${FA_DEPLOY_NGINX:-false}"
deploy_bootstrap_origin_http_only=false
deploy_sha="${FA_DEPLOY_SHA:-}"
loaded_prod_env_file="/etc/fa/.env.prod"
deployment_check_timeout_seconds=90
deployment_check_interval_seconds=3
key_file=""
known_hosts_file=""
temp_scan_file=""

usage() {
  printf 'Usage: %s --sha <git-sha> [--deploy-nginx] [--bootstrap-origin-http-only]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  [[ -n "${key_file}" ]] && rm -f "${key_file}"
  [[ -n "${known_hosts_file}" ]] && rm -f "${known_hosts_file}"
  [[ -n "${temp_scan_file}" ]] && rm -f "${temp_scan_file}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --sha)
        shift
        [[ $# -gt 0 ]] || fail "--sha requires a value"
        deploy_sha="$1"
        shift
        ;;
      --sha=*)
        deploy_sha="${1#*=}"
        shift
        ;;
      --deploy-nginx)
        deploy_nginx=true
        shift
        ;;
      --bootstrap-origin-http-only)
        deploy_bootstrap_origin_http_only=true
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
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

is_placeholder_value() {
  [[ "$1" == replace-with-* ]]
}

validate_inputs() {
  [[ -n "${deploy_sha}" ]] || fail "--sha is required"
  [[ -n "${FA_HETZNER_PROD_HOST}" ]] || fail "FA_HETZNER_PROD_HOST is required"
  [[ -n "${FA_HETZNER_PROD_HOST_KEY_SHA256}" ]] || fail "FA_HETZNER_PROD_HOST_KEY_SHA256 is required"
  [[ "${FA_HETZNER_PROD_HOST_KEY_SHA256}" == SHA256:* ]] || fail "FA_HETZNER_PROD_HOST_KEY_SHA256 must be the SHA256:... token reported by ssh-keygen -lf -"
  [[ -n "${FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY}" ]] || fail "FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY is required"
  [[ -n "${FA_AUTH0_DOMAIN}" ]] || fail "FA_AUTH0_DOMAIN is required"
  [[ -n "${FA_AUTH0_CLIENT_ID}" ]] || fail "FA_AUTH0_CLIENT_ID is required"
  [[ -n "${FA_AUTH0_AUDIENCE}" ]] || fail "FA_AUTH0_AUDIENCE is required"
  ! is_placeholder_value "${FA_AUTH0_DOMAIN}" || fail "FA_AUTH0_DOMAIN still contains a placeholder value"
  ! is_placeholder_value "${FA_AUTH0_CLIENT_ID}" || fail "FA_AUTH0_CLIENT_ID still contains a placeholder value"
  ! is_placeholder_value "${FA_AUTH0_AUDIENCE}" || fail "FA_AUTH0_AUDIENCE still contains a placeholder value"
  [[ "${FA_HETZNER_SSH_PORT}" =~ ^[0-9]+$ ]] || fail "FA_HETZNER_SSH_PORT must be numeric"
  case "${deploy_nginx}" in
    true|false) ;;
    *) fail "FA_DEPLOY_NGINX must be true or false" ;;
  esac
  case "${deploy_bootstrap_origin_http_only}" in
    true|false) ;;
    *) fail "deploy_bootstrap_origin_http_only must be true or false" ;;
  esac
}

verify_auth0_authorize_preflight() {
  FA_PUBLIC_ORIGIN="https://${FA_PROD_DOMAIN}" node scripts/smoke/auth0-authorize-preflight.mjs
}

parse_ssh_key_fingerprint() {
  local fingerprint_line="$1"

  if [[ "${fingerprint_line}" =~ ^[0-9]+[[:space:]]+(SHA256:[^[:space:]]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

setup_ssh() {
  local fingerprint=""
  local fingerprint_line=""
  local key_line=""
  local match_count=0
  local matching_key_line=""

  key_file="$(mktemp "${TMPDIR:-/tmp}/fa-hetzner-key.XXXXXX")"
  known_hosts_file="$(mktemp "${TMPDIR:-/tmp}/fa-hetzner-known-hosts.XXXXXX")"
  temp_scan_file="$(mktemp "${TMPDIR:-/tmp}/fa-hetzner-keyscan.XXXXXX")"
  chmod 600 "${key_file}" "${known_hosts_file}" "${temp_scan_file}"

  printf '%s\n' "${FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY}" | tr -d '\r' > "${key_file}"
  chmod 600 "${key_file}"
  if ! ssh-keyscan -p "${FA_HETZNER_SSH_PORT}" -H "${FA_HETZNER_PROD_HOST}" > "${temp_scan_file}"; then
    fail "ssh-keyscan failed for ${FA_HETZNER_PROD_HOST}:${FA_HETZNER_SSH_PORT}"
  fi

  while IFS= read -r key_line || [[ -n "${key_line}" ]]; do
    [[ -n "${key_line}" ]] || continue
    [[ "${key_line}" == \#* ]] && continue

    if ! fingerprint_line="$(printf '%s\n' "${key_line}" | ssh-keygen -lf - 2>/dev/null)"; then
      continue
    fi

    if ! fingerprint="$(parse_ssh_key_fingerprint "${fingerprint_line}")"; then
      fail "Unable to parse scanned SSH host key fingerprint"
    fi

    if [[ "${fingerprint}" == "${FA_HETZNER_PROD_HOST_KEY_SHA256}" ]]; then
      match_count=$((match_count + 1))
      matching_key_line="${key_line}"
    fi
  done < "${temp_scan_file}"

  [[ "${match_count}" -gt 0 ]] || fail "No scanned SSH host key matched FA_HETZNER_PROD_HOST_KEY_SHA256"
  [[ "${match_count}" -eq 1 ]] || fail "Multiple scanned SSH host keys matched FA_HETZNER_PROD_HOST_KEY_SHA256"

  printf '%s\n' "${matching_key_line}" > "${known_hosts_file}"
}

ssh_command_string() {
  printf 'ssh -i %q -p %q -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q' \
    "${key_file}" \
    "${FA_HETZNER_SSH_PORT}" \
    "${known_hosts_file}"
}

run_remote() {
  local command="$1"
  ssh -i "${key_file}" \
    -p "${FA_HETZNER_SSH_PORT}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${known_hosts_file}" \
    "${FA_HETZNER_DEPLOY_USER}@${FA_HETZNER_PROD_HOST}" \
    "${command}"
}

run_remote_capture() {
  local command="$1"
  ssh -i "${key_file}" \
    -p "${FA_HETZNER_SSH_PORT}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${known_hosts_file}" \
    "${FA_HETZNER_DEPLOY_USER}@${FA_HETZNER_PROD_HOST}" \
    "${command}" 2>&1
}

sync_release() {
  local release_dir="${FA_HETZNER_RELEASES_DIR%/}/${deploy_sha}"
  local ssh_command=""

  run_remote "mkdir -p '${release_dir}'"
  ssh_command="$(ssh_command_string)"
  rsync -az --delete \
    --exclude '.git/' \
    --exclude '.terraform/' \
    --exclude '.env*' \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude 'coverage/' \
    --exclude '*.tfstate' \
    --exclude '*.tfstate.*' \
    -e "${ssh_command}" \
    ./ "${FA_HETZNER_DEPLOY_USER}@${FA_HETZNER_PROD_HOST}:${release_dir}/"
}

write_remote_public_runtime_config_file() {
  local release_dir="$1"
  local config_file="${release_dir}/.fa-public-runtime.env"
  local quoted_config_file=""

  printf -v quoted_config_file '%q' "${config_file}"

  run_remote "cat > ${quoted_config_file} <<'FA_PUBLIC_RUNTIME_CONFIG'
FA_AUTH0_DOMAIN=${FA_AUTH0_DOMAIN}
FA_AUTH0_CLIENT_ID=${FA_AUTH0_CLIENT_ID}
FA_AUTH0_AUDIENCE=${FA_AUTH0_AUDIENCE}
FA_PUBLIC_RUNTIME_CONFIG
chmod 0600 ${quoted_config_file}"
}

remove_remote_public_runtime_config_file() {
  local release_dir="$1"
  local config_file="${release_dir}/.fa-public-runtime.env"
  local quoted_config_file=""

  printf -v quoted_config_file '%q' "${config_file}"
  run_remote "rm -f ${quoted_config_file}"
}

ensure_remote_key_readable() {
  local key_path="$1"
  local key_dir=""
  local key_name=""
  local quoted_key_path=""
  local quoted_key_dir=""
  local quoted_key_name=""

  key_dir="$(dirname "${key_path}")"
  key_name="$(basename "${key_path}")"
  printf -v quoted_key_path '%q' "${key_path}"
  printf -v quoted_key_dir '%q' "${key_dir}"
  printf -v quoted_key_name '%q' "${key_name}"

  run_remote "if [[ -r ${quoted_key_path} ]]; then exit 0; fi; deploy_gid=\$(id -g); image=\$(docker ps --filter name=fa-services --format '{{.Image}}' | head -n1); image=\${image:-fa-services:latest}; docker run --rm -v ${quoted_key_dir}:/host-keys --entrypoint /bin/sh \"\${image}\" -c \"chown 0:\${deploy_gid} /host-keys/${quoted_key_name} && chmod 0440 /host-keys/${quoted_key_name}\"; [[ -r ${quoted_key_path} ]]"
}

verify_rendered_public_runtime_config() {
  local env_file="${1:-/etc/fa/.env.prod}"
  local quoted_env_file=""
  local quoted_auth0_domain=""
  local quoted_auth0_client_id=""
  local quoted_auth0_audience=""

  printf -v quoted_env_file '%q' "${env_file}"
  printf -v quoted_auth0_domain '%q' "${FA_AUTH0_DOMAIN}"
  printf -v quoted_auth0_client_id '%q' "${FA_AUTH0_CLIENT_ID}"
  printf -v quoted_auth0_audience '%q' "${FA_AUTH0_AUDIENCE}"

  run_remote "set -a && . ${quoted_env_file} && set +a && [[ \"\${FA_AUTH0_DOMAIN}\" == ${quoted_auth0_domain} ]] && [[ \"\${FA_AUTH0_CLIENT_ID}\" == ${quoted_auth0_client_id} ]] && [[ \"\${FA_AUTH0_AUDIENCE}\" == ${quoted_auth0_audience} ]]"
}

load_release_local_secrets() {
  local release_dir="$1"
  local release_env_file="${release_dir}/.env.prod"
  local quoted_release_dir=""
  local quoted_release_env_file=""
  local quoted_auth0_domain=""
  local quoted_auth0_client_id=""
  local quoted_auth0_audience=""

  printf -v quoted_release_dir '%q' "${release_dir}"
  printf -v quoted_release_env_file '%q' "${release_env_file}"
  printf -v quoted_auth0_domain '%q' "${FA_AUTH0_DOMAIN}"
  printf -v quoted_auth0_client_id '%q' "${FA_AUTH0_CLIENT_ID}"
  printf -v quoted_auth0_audience '%q' "${FA_AUTH0_AUDIENCE}"

  ensure_remote_key_readable /etc/fa/keys/provisioner-sa-key.json
  run_remote "cd ${quoted_release_dir} && FA_ENVIRONMENT=prod FA_PROD_ENV_FILE=${quoted_release_env_file} bash scripts/hetzner/load-secrets.sh --auth0-domain ${quoted_auth0_domain} --auth0-client-id ${quoted_auth0_client_id} --auth0-audience ${quoted_auth0_audience} --output ${quoted_release_env_file}"
  verify_rendered_public_runtime_config "${release_env_file}"
  ensure_remote_key_readable /etc/fa/keys/runtime-sa-key.json
  loaded_prod_env_file="${release_env_file}"
}

load_remote_secrets() {
  local release_dir="$1"
  local quoted_release_dir=""
  local quoted_auth0_domain=""
  local quoted_auth0_client_id=""
  local quoted_auth0_audience=""
  local output=""

  printf -v quoted_release_dir '%q' "${release_dir}"
  printf -v quoted_auth0_domain '%q' "${FA_AUTH0_DOMAIN}"
  printf -v quoted_auth0_client_id '%q' "${FA_AUTH0_CLIENT_ID}"
  printf -v quoted_auth0_audience '%q' "${FA_AUTH0_AUDIENCE}"

  if output="$(run_remote_capture "sudo -n /usr/local/sbin/fa-load-secrets --auth0-domain ${quoted_auth0_domain} --auth0-client-id ${quoted_auth0_client_id} --auth0-audience ${quoted_auth0_audience} ${quoted_release_dir}")"; then
    printf '%s\n' "${output}"
    verify_rendered_public_runtime_config
    loaded_prod_env_file="/etc/fa/.env.prod"
    return
  fi

  if [[ "${output}" != *"Usage: fa-load-secrets <release-or-current-dir>"* ]]; then
    printf '%s\n' "${output}" >&2
    fail "fa-load-secrets failed"
  fi

  printf 'Detected retired fa-load-secrets wrapper; generating release-local env with current loader.\n'
  write_remote_public_runtime_config_file "${release_dir}"
  load_release_local_secrets "${release_dir}"
  remove_remote_public_runtime_config_file "${release_dir}"
}

deploy_remote_release() {
  local release_dir="${FA_HETZNER_RELEASES_DIR%/}/${deploy_sha}"
  local quoted_release_dir=""
  local quoted_current_dir=""
  local quoted_sha=""
  local quoted_grafana_instance_url=""
  local quoted_loki_datasource_uid=""
  local quoted_alert_router_webhook_url=""
  local quoted_loaded_prod_env_file=""

  printf -v quoted_release_dir '%q' "${release_dir}"
  printf -v quoted_current_dir '%q' "${FA_HETZNER_CURRENT_DIR}"
  printf -v quoted_sha '%q' "${deploy_sha}"
  printf -v quoted_grafana_instance_url '%q' "${FA_GRAFANA_INSTANCE_URL}"
  printf -v quoted_loki_datasource_uid '%q' "${FA_GRAFANA_LOKI_DATASOURCE_UID}"
  printf -v quoted_alert_router_webhook_url '%q' "${FA_ALERT_ROUTER_WEBHOOK_URL}"

  run_remote "cd ${quoted_release_dir} && corepack enable && pnpm install --frozen-lockfile"
  load_remote_secrets "${release_dir}"
  printf -v quoted_loaded_prod_env_file '%q' "${loaded_prod_env_file}"
  run_remote "cd ${quoted_release_dir} && set -a && . ${quoted_loaded_prod_env_file} && set +a && GOOGLE_APPLICATION_CREDENTIALS=/etc/fa/keys/runtime-sa-key.json pnpm run verify:data-baseline"
  run_remote "cd ${quoted_release_dir} && FA_ENVIRONMENT=prod bash scripts/hetzner/build-services-image.sh --sha ${quoted_sha}"
  run_remote "cd ${quoted_release_dir} && FA_ENVIRONMENT=prod FA_PROD_ENV_FILE=${quoted_loaded_prod_env_file} bash scripts/hetzner/deploy-web.sh --sha ${quoted_sha}"
  run_remote "ln -sfn ${quoted_release_dir} ${quoted_current_dir}"
  run_remote "cd ${quoted_current_dir} && FA_ENVIRONMENT=prod FA_PROD_ENV_FILE=${quoted_loaded_prod_env_file} bash scripts/hetzner/reload-services-container.sh --sha ${quoted_sha}"

  if [[ "${deploy_nginx}" == "true" ]]; then
    if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]; then
      run_remote "sudo -n /usr/local/sbin/fa-deploy-nginx ${quoted_current_dir} --origin-http-only"
    else
      run_remote "sudo -n /usr/local/sbin/fa-deploy-nginx ${quoted_current_dir}"
    fi
  fi

  run_remote "sudo -n /usr/local/sbin/fa-load-observability-env ${quoted_current_dir} ${quoted_grafana_instance_url} ${quoted_loki_datasource_uid} ${quoted_alert_router_webhook_url}"
  run_remote "sudo -n /usr/local/sbin/fa-install-observability ${quoted_current_dir} ${quoted_sha} --with-alert-router"
}

wait_for_remote_http_status() {
  local url="$1"
  local expected_status="$2"
  local header="${3:-}"
  local quoted_url=""
  local quoted_header=""
  local quoted_label=""

  printf -v quoted_url '%q' "${url}"
  printf -v quoted_label '%q' "${url}"
  if [[ -n "${header}" ]]; then
    printf -v quoted_header '%q' "${header}"
    run_remote "deadline=\$((\$(date +%s) + ${deployment_check_timeout_seconds})); last_status=not_checked; while [[ \$(date +%s) -le \${deadline} ]]; do status=\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' -H ${quoted_header} ${quoted_url} || printf 'curl_failed'); last_status=\"\${status}\"; [[ \"\${status}\" == \"${expected_status}\" ]] && exit 0; sleep ${deployment_check_interval_seconds}; done; printf 'Timed out waiting for %s to return HTTP ${expected_status}; last status: %s\n' ${quoted_label} \"\${last_status}\" >&2; exit 1"
  else
    run_remote "deadline=\$((\$(date +%s) + ${deployment_check_timeout_seconds})); last_status=not_checked; while [[ \$(date +%s) -le \${deadline} ]]; do status=\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' ${quoted_url} || printf 'curl_failed'); last_status=\"\${status}\"; [[ \"\${status}\" == \"${expected_status}\" ]] && exit 0; sleep ${deployment_check_interval_seconds}; done; printf 'Timed out waiting for %s to return HTTP ${expected_status}; last status: %s\n' ${quoted_label} \"\${last_status}\" >&2; exit 1"
  fi
}

assert_remote_http_status() {
  wait_for_remote_http_status "$@"
}

assert_remote_http_200() {
  assert_remote_http_status "$1" 200 "${2:-}"
}

wait_for_remote_https_origin_http_status() {
  local path="$1"
  local expected_status="$2"
  local header="${3:-}"
  local resolve_arg=""
  local url=""
  local quoted_header=""
  local label=""
  local quoted_label=""

  printf -v resolve_arg '%q' "${FA_PROD_DOMAIN}:443:127.0.0.1"
  label="https://${FA_PROD_DOMAIN}${path} via local origin"
  printf -v url '%q' "https://${FA_PROD_DOMAIN}${path}"
  printf -v quoted_label '%q' "${label}"
  if [[ -n "${header}" ]]; then
    printf -v quoted_header '%q' "${header}"
    run_remote "deadline=\$((\$(date +%s) + ${deployment_check_timeout_seconds})); last_status=not_checked; while [[ \$(date +%s) -le \${deadline} ]]; do status=\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' -H ${quoted_header} --resolve ${resolve_arg} ${url} || printf 'curl_failed'); last_status=\"\${status}\"; [[ \"\${status}\" == \"${expected_status}\" ]] && exit 0; sleep ${deployment_check_interval_seconds}; done; printf 'Timed out waiting for %s to return HTTP ${expected_status}; last status: %s\n' ${quoted_label} \"\${last_status}\" >&2; exit 1"
  else
    run_remote "deadline=\$((\$(date +%s) + ${deployment_check_timeout_seconds})); last_status=not_checked; while [[ \$(date +%s) -le \${deadline} ]]; do status=\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' --resolve ${resolve_arg} ${url} || printf 'curl_failed'); last_status=\"\${status}\"; [[ \"\${status}\" == \"${expected_status}\" ]] && exit 0; sleep ${deployment_check_interval_seconds}; done; printf 'Timed out waiting for %s to return HTTP ${expected_status}; last status: %s\n' ${quoted_label} \"\${last_status}\" >&2; exit 1"
  fi
}

assert_remote_https_origin_http_status() {
  wait_for_remote_https_origin_http_status "$@"
}

assert_remote_https_origin_http_200() {
  assert_remote_https_origin_http_status "$1" 200 "${2:-}"
}

wait_for_https_edge_http_status() {
  local path="$1"
  local expected_status="$2"
  local header="${3:-}"
  local deadline=$((SECONDS + deployment_check_timeout_seconds))
  local last_status="not_checked"
  local status=""
  local curl_args=(--silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}')

  if [[ -n "${header}" ]]; then
    curl_args+=(-H "${header}")
  fi

  while ((SECONDS <= deadline)); do
    status="$(curl "${curl_args[@]}" \
      --resolve "${FA_PROD_DOMAIN}:443:${FA_HETZNER_PROD_HOST}" \
      "https://${FA_PROD_DOMAIN}${path}" || printf 'curl_failed')"
    last_status="${status}"
    [[ "${status}" == "${expected_status}" ]] && return 0
    sleep "${deployment_check_interval_seconds}"
  done

  fail "Timed out waiting for https://${FA_PROD_DOMAIN}${path} to return HTTP ${expected_status}; last status: ${last_status}"
}

assert_https_edge_http_status() {
  wait_for_https_edge_http_status "$@"
}

assert_https_edge_http_200() {
  assert_https_edge_http_status "$1" 200 "${2:-}"
}

wait_for_remote_systemd_active() {
  local service_name="$1"
  local quoted_service_name=""

  printf -v quoted_service_name '%q' "${service_name}"
  run_remote "deadline=\$((\$(date +%s) + ${deployment_check_timeout_seconds})); last_status=not_checked; while [[ \$(date +%s) -le \${deadline} ]]; do if systemctl is-active --quiet ${quoted_service_name}; then exit 0; fi; last_status=\$(systemctl is-active ${quoted_service_name} 2>/dev/null || true); [[ -n \"\${last_status}\" ]] || last_status=unknown; sleep ${deployment_check_interval_seconds}; done; printf 'Timed out waiting for %s to become active; last status: %s\n' ${quoted_service_name} \"\${last_status}\" >&2; exit 1"
}

verify_service_health() {
  assert_remote_http_200 http://127.0.0.1:3201/health
  assert_remote_http_200 http://127.0.0.1:3202/health
  assert_remote_http_200 http://127.0.0.1:3203/health
  assert_remote_http_200 http://127.0.0.1:3204/health
}

verify_observability_health() {
  wait_for_remote_systemd_active fa-alloy
  wait_for_remote_systemd_active fa-alert-router
  assert_remote_http_200 http://127.0.0.1:9002/health
}

verify_local_origin_health() {
  if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]; then
    assert_remote_http_200 http://127.0.0.1/healthz
    assert_remote_http_200 http://127.0.0.1/
    assert_remote_http_200 http://127.0.0.1/index.html
    assert_remote_http_200 http://127.0.0.1/app
    assert_remote_http_200 http://127.0.0.1/api/chat/health
    assert_remote_http_200 http://127.0.0.1/api/knowledge/health
    assert_remote_http_200 http://127.0.0.1/api/llm-usage/health
    assert_remote_http_200 http://127.0.0.1/api/users/health
  else
    assert_remote_https_origin_http_200 /healthz
    verify_local_origin_public_entrypoints
  fi
}

verify_local_origin_public_entrypoints() {
  assert_remote_https_origin_http_200 /
  assert_remote_https_origin_http_200 /index.html
  assert_remote_https_origin_http_200 /app
  assert_remote_https_origin_http_200 /api/chat/health
  assert_remote_https_origin_http_200 /api/knowledge/health
  assert_remote_https_origin_http_200 /api/llm-usage/health
  assert_remote_https_origin_http_200 /api/users/health
}

verify_https_edge_public_entrypoints() {
  assert_https_edge_http_200 /
  assert_https_edge_http_200 /index.html
  assert_https_edge_http_200 /app
  assert_https_edge_http_200 /api/chat/health
  assert_https_edge_http_200 /api/knowledge/health
  assert_https_edge_http_200 /api/llm-usage/health
  assert_https_edge_http_200 /api/users/health
}

verify_https_edge_health() {
  assert_https_edge_http_200 /healthz
  verify_https_edge_public_entrypoints
}

verify_deployment() {
  verify_service_health
  verify_observability_health
  verify_local_origin_health

  if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]; then
    printf 'Skipped HTTPS edge health checks because --bootstrap-origin-http-only was set\n'
  else
    verify_https_edge_health
  fi
}

main() {
  trap cleanup EXIT
  parse_args "$@"
  require_command curl
  require_command git
  require_command rsync
  require_command ssh
  require_command ssh-keygen
  require_command ssh-keyscan
  validate_inputs
  verify_auth0_authorize_preflight
  setup_ssh
  sync_release
  deploy_remote_release
  verify_deployment
  printf 'FA Hetzner production deployment completed for %s at %s\n' "${FA_PROD_DOMAIN}" "${deploy_sha}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

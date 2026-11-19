#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "${script_dir}/../.." && pwd -P)"
environment="dev"
host_name=""
deploy_sha="${FA_RELEASE_SHA:-unknown}"
with_alert_router=false
pm2_log_dir=""

usage() {
  cat <<'USAGE'
DEV: follow "Install On DEV" in docs/operations/fa-observability-runbook.md.
PROD: sudo scripts/observability/install-alloy.sh --environment prod --host hetzner-prod --sha <git-sha> [--with-alert-router]
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --environment)
        shift
        [[ $# -gt 0 ]] || fail "--environment requires a value"
        environment="$1"
        shift
        ;;
      --environment=*)
        environment="${1#*=}"
        shift
        ;;
      --host)
        shift
        [[ $# -gt 0 ]] || fail "--host requires a value"
        host_name="$1"
        shift
        ;;
      --host=*)
        host_name="${1#*=}"
        shift
        ;;
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
      --pm2-log-dir)
        shift
        [[ $# -gt 0 ]] || fail "--pm2-log-dir requires a value"
        pm2_log_dir="$1"
        shift
        ;;
      --with-alert-router)
        with_alert_router=true
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

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Run this script as root"
}

require_protected_path() {
  local path="$1" metadata
  [[ ! -L "$path" ]] || fail "Unexpected symlink in DEV release: $path"
  metadata="$(stat -c '%u:%a' -- "$path")" || fail "Missing DEV release path: $path"
  [[ "${metadata%%:*}" == 0 && $((8#${metadata#*:} & 022)) -eq 0 ]] ||
    fail "DEV release path must be root-owned and protected from writes: $path"
}

require_dev_release() {
  [[ "$script_dir" == "$repo_root/scripts/observability" &&
     "$repo_root" =~ ^/var/lib/fa-observability-install\.[a-zA-Z0-9]{8}/release$ ]] ||
    fail 'Run the DEV installer from a verified root-owned release. See "Install On DEV" in the observability runbook.'

  local path
  for path in / /var /var/lib "${repo_root%/release}" "$repo_root" \
    "$repo_root/scripts" "$script_dir" "$script_dir/templates" "$repo_root/scripts/dev-host"; do
    [[ -d "$path" ]] || fail "Missing DEV release directory: $path"
    require_protected_path "$path"
  done

  for path in "$script_dir/install-alloy.sh" "$script_dir/install-dev-alloy-reader.sh" \
    "$script_dir/install-dev-journal-scope.sh" "$script_dir/render-alloy-config.mjs" \
    "$script_dir/templates/fa-dev.alloy.tmpl" "$script_dir/fa-alloy.service" \
    "$script_dir/alert-router.mjs" "$repo_root/scripts/dev-host/fa-alert-router.service"; do
    [[ -f "$path" ]] || fail "Missing DEV release file: $path"
    require_protected_path "$path"
  done
}

detect_host() {
  if [[ -n "${host_name}" ]]; then
    return
  fi

  host_name="$(hostname -f 2>/dev/null || hostname)"
}

validate_inputs() {
  case "${environment}" in
    dev|prod) ;;
    *) fail "--environment must be dev or prod" ;;
  esac

  [[ -n "${host_name}" ]] || fail "--host is required"
}

install_alloy_package() {
  if command -v alloy >/dev/null 2>&1; then
    return
  fi

  command -v apt-get >/dev/null 2>&1 || fail "apt-get is required to install Grafana Alloy"
  command -v curl >/dev/null 2>&1 || fail "curl is required to install Grafana Alloy"

  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg-full.key -o /etc/apt/keyrings/grafana.asc
  chmod 0644 /etc/apt/keyrings/grafana.asc
  printf 'deb [signed-by=/etc/apt/keyrings/grafana.asc] https://apt.grafana.com stable main\n' \
    > /etc/apt/sources.list.d/grafana.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y alloy
}

grant_alloy_log_access() {
  if ! id -u alloy >/dev/null 2>&1; then
    return
  fi

  local groups=()
  local joined=""
  for group in adm docker systemd-journal; do
    if getent group "${group}" >/dev/null 2>&1; then
      groups+=("${group}")
    fi
  done

  if [[ "${#groups[@]}" -gt 0 ]]; then
    joined="$(IFS=,; printf '%s' "${groups[*]}")"
    usermod -aG "${joined}" alloy
  fi
}

render_config() {
  local render_args=()
  local dev_home=""

  render_args=(
    --environment "${environment}"
    --host "${host_name}"
    --sha "${deploy_sha}"
  )

  if [[ "${environment}" == "dev" ]]; then
    pm2_log_dir="${pm2_log_dir:-${FA_PM2_LOG_DIR:-}}"
    if [[ -z "${pm2_log_dir}" && -n "${FA_PM2_HOME:-}" ]]; then
      pm2_log_dir="${FA_PM2_HOME}/logs"
    fi
    if [[ -z "${pm2_log_dir}" && -n "${SUDO_USER:-}" ]] && getent passwd "${SUDO_USER}" >/dev/null 2>&1; then
      dev_home="$(getent passwd "${SUDO_USER}" | cut -d: -f6)"
      pm2_log_dir="${dev_home}/.pm2-fa/logs"
    fi
    if [[ -z "${pm2_log_dir}" ]]; then
      pm2_log_dir="${HOME}/.pm2-fa/logs"
    fi
    bash "${script_dir}/install-dev-alloy-reader.sh" --render "${pm2_log_dir}" >/dev/null
    render_args+=(--pm2-log-dir "${pm2_log_dir}")
  fi

  install -d -o root -g root -m 755 /etc/fa/alloy
  node "${repo_root}/scripts/observability/render-alloy-config.mjs" \
    "${render_args[@]}" \
    --output /etc/fa/alloy/fa.alloy
  chmod 0644 /etc/fa/alloy/fa.alloy
}

install_alloy_service() {
  install -m 0644 \
    "${repo_root}/scripts/observability/fa-alloy.service" \
    /etc/systemd/system/fa-alloy.service
  systemctl daemon-reload
  systemctl enable fa-alloy
  if [[ "${environment}" == "dev" ]]; then
    bash "${repo_root}/scripts/observability/install-dev-alloy-reader.sh" --install "${pm2_log_dir}"
    bash "${repo_root}/scripts/observability/install-dev-journal-scope.sh" --install
  else
    systemctl restart fa-alloy
  fi
}

ensure_alert_router_entrypoint() {
  if [[ ! -f "${repo_root}/scripts/observability/alert-router.mjs" ]]; then
    fail "scripts/observability/alert-router.mjs is not present yet; rerun with --with-alert-router after the alert router is implemented"
  fi
}

install_alert_router_service() {
  local source_unit=""

  ensure_alert_router_entrypoint

  case "${environment}" in
    dev) source_unit="${repo_root}/scripts/dev-host/fa-alert-router.service" ;;
    prod) source_unit="${repo_root}/scripts/hetzner/fa-alert-router.service" ;;
  esac

  install -m 0644 "${source_unit}" /etc/systemd/system/fa-alert-router.service
  systemctl daemon-reload
  systemctl enable fa-alert-router
  systemctl restart fa-alert-router
}

print_verification_commands() {
  printf 'Grafana Alloy installed. Verify with:\n'
  printf '  systemctl status fa-alloy --no-pager\n'
  printf '  journalctl -u fa-alloy -n 100 --no-pager\n'

  if [[ "${with_alert_router}" == "true" ]]; then
    printf 'Alert router installed. Verify with:\n'
    printf '  systemctl status fa-alert-router --no-pager\n'
    if [[ "${environment}" == "dev" ]]; then
      printf '  journalctl --namespace=fa-dev -u fa-alert-router -n 100 --no-pager\n'
    else
      printf '  journalctl -u fa-alert-router -n 100 --no-pager\n'
    fi
  fi
}

main() {
  parse_args "$@"
  if [[ "${environment}" == "dev" ]]; then
    require_dev_release
  fi
  require_root
  detect_host
  validate_inputs
  install_alloy_package
  if [[ "${environment}" == "prod" ]]; then
    grant_alloy_log_access
  fi
  render_config
  install_alloy_service

  if [[ "${with_alert_router}" == "true" ]]; then
    install_alert_router_service
  fi

  print_verification_commands
}

main "$@"

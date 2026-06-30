#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
target_host="hetzner-prod"
deploy_sha="${FA_RELEASE_SHA:-unknown}"
with_alert_router=false

usage() {
  cat <<'USAGE'
Usage: sudo FA_ENVIRONMENT=prod scripts/hetzner/install-observability.sh [--sha <git-sha>] [--host hetzner-prod] [--with-alert-router]
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
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
      --host)
        shift
        [[ $# -gt 0 ]] || fail "--host requires a value"
        target_host="$1"
        shift
        ;;
      --host=*)
        target_host="${1#*=}"
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

require_prod() {
  [[ "${FA_ENVIRONMENT:-}" == "prod" ]] || fail "FA_ENVIRONMENT must be prod"
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "Run this script as root"
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
  install -d -o root -g root -m 755 /etc/fa/alloy
  node "${repo_root}/scripts/observability/render-alloy-config.mjs" \
    --environment prod \
    --host "${target_host}" \
    --sha "${deploy_sha}" \
    --output /etc/fa/alloy/fa.alloy
  chmod 0644 /etc/fa/alloy/fa.alloy
}

install_alloy_service() {
  install -m 0644 \
    "${repo_root}/scripts/observability/fa-alloy.service" \
    /etc/systemd/system/fa-alloy.service
  systemctl daemon-reload
  systemctl enable fa-alloy
  systemctl restart fa-alloy
}

ensure_alert_router_entrypoint() {
  if [[ ! -f "${repo_root}/scripts/observability/alert-router.mjs" ]]; then
    fail "scripts/observability/alert-router.mjs is not present yet; rerun with --with-alert-router after the alert router is implemented"
  fi
}

install_alert_router_service() {
  ensure_alert_router_entrypoint

  install -m 0644 \
    "${repo_root}/scripts/hetzner/fa-alert-router.service" \
    /etc/systemd/system/fa-alert-router.service
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
    printf '  journalctl -u fa-alert-router -n 100 --no-pager\n'
  fi
}

main() {
  parse_args "$@"
  require_prod
  require_root
  install_alloy_package
  grant_alloy_log_access
  render_config
  install_alloy_service

  if [[ "${with_alert_router}" == "true" ]]; then
    install_alert_router_service
  fi

  print_verification_commands
}

main "$@"

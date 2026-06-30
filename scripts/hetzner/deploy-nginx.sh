#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"
NGINX_SOURCE="${SCRIPT_DIR}/nginx/fishing-assistant.conf"
ORIGIN_HTTP_SOURCE="${SCRIPT_DIR}/nginx/fishing-assistant.origin-http.conf"
site_target="/etc/nginx/sites-available/fishing-assistant.conf"
site_enabled="/etc/nginx/sites-enabled/fishing-assistant.conf"
RELOAD_NGINX=1
NGINX_MODE="https"

usage() {
  printf 'Usage: FA_ENVIRONMENT=prod %s [--origin-http-only] [--skip-reload]\n' "$(basename "$0")"
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
      --skip-reload)
        RELOAD_NGINX=0
        shift
        ;;
      --origin-http-only)
        NGINX_SOURCE="${ORIGIN_HTTP_SOURCE}"
        NGINX_MODE="origin-http-only"
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
  parse_args "$@"
  require_prod
  require_root
  command -v nginx >/dev/null 2>&1 || fail "nginx is required"
  [[ -r "${NGINX_SOURCE}" ]] || fail "Missing nginx config source: ${NGINX_SOURCE}"

  install -d -m 755 "$(dirname "${site_target}")" "$(dirname "${site_enabled}")"
  install -m 644 -o root -g root "${NGINX_SOURCE}" "${site_target}"
  ln -sfn "${site_target}" "${site_enabled}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  reload_nginx
  printf 'Deployed %s nginx config for fishing-assistant.online\n' "${NGINX_MODE}"
}

main "$@"

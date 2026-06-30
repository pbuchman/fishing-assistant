#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FA_PROD_ENV_FILE="${FA_PROD_ENV_FILE:-/etc/fa/.env.prod}"
FA_HETZNER_WEB_RELEASES_DIR="${FA_HETZNER_WEB_RELEASES_DIR:-/var/www/fa/releases}"
FA_HETZNER_WEB_ROOT="${FA_HETZNER_WEB_ROOT:-/var/www/fa/current}"
FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"
deploy_sha="${FA_DEPLOY_SHA:-}"

web_safe_keys=(
  FA_ENVIRONMENT
  FA_PUBLIC_ORIGIN
  FA_WEB_APP_URL
  FA_CHAT_SERVICE_URL
  FA_KNOWLEDGE_SERVICE_URL
  FA_LLM_USAGE_SERVICE_URL
  FA_USER_SERVICE_URL
  FA_AUTH0_DOMAIN
  FA_AUTH0_CLIENT_ID
  FA_AUTH0_AUDIENCE
)

usage() {
  printf 'Usage: FA_ENVIRONMENT=prod %s --sha <git-sha>\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_prod() {
  [[ "${FA_ENVIRONMENT}" == "prod" ]] || fail "FA_ENVIRONMENT must be prod"
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

read_env_value() {
  local key="$1"

  [[ -f "${FA_PROD_ENV_FILE}" ]] || fail "Env file not found: ${FA_PROD_ENV_FILE}"
  node -e '
    const { readFileSync } = require("node:fs");
    const key = process.argv[1];
    const envFile = process.argv[2];
    const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
    const unquote = (value) => {
      if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
        return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
      }
      return value;
    };
    for (const line of lines) {
      if (line === "" || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      if (line.slice(0, index) === key) {
        process.stdout.write(unquote(line.slice(index + 1)));
        process.exit(0);
      }
    }
  ' "${key}" "${FA_PROD_ENV_FILE}"
}

export_web_safe_env() {
  local key=""
  local value=""

  for key in "${web_safe_keys[@]}"; do
    value="$(read_env_value "${key}")"
    export "${key}=${value}"
  done
}

publish_web() {
  local release_dir=""

  [[ -n "${deploy_sha}" ]] || fail "--sha is required"
  release_dir="${FA_HETZNER_WEB_RELEASES_DIR%/}/${deploy_sha}"

  cd "${repo_dir}"
  export_web_safe_env
  pnpm --filter @fa/web build

  [[ -f apps/web/dist/index.html ]] || fail "apps/web/dist/index.html was not produced"
  install -d -m 755 "${release_dir}" "$(dirname "${FA_HETZNER_WEB_ROOT}")"
  rsync -a --delete apps/web/dist/ "${release_dir}/"
  ln -sfn "${release_dir}" "${FA_HETZNER_WEB_ROOT}"
}

main() {
  parse_args "$@"
  require_prod
  command -v node >/dev/null 2>&1 || fail "node is required"
  command -v pnpm >/dev/null 2>&1 || fail "pnpm is required"
  command -v rsync >/dev/null 2>&1 || fail "rsync is required"
  publish_web
  printf 'Published FA web bundle for %s\n' "${deploy_sha}"
}

main "$@"

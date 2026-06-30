#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

deploy_sha="${FA_DEPLOY_SHA:-}"
FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"
FA_PROD_ENV_FILE="${FA_PROD_ENV_FILE:-/etc/fa/.env.prod}"
FA_HETZNER_RUNTIME_KEY_FILE="${FA_HETZNER_RUNTIME_KEY_FILE:-/etc/fa/keys/runtime-sa-key.json}"
container_name="fa-services"

usage() {
  printf 'Usage: FA_ENVIRONMENT=prod %s --sha <git-sha>\n' "$(basename "$0")"
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

wait_for_health() {
  local url="$1"
  local deadline=$((SECONDS + 90))

  while ((SECONDS < deadline)); do
    if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
      return 0
    fi
    sleep 3
  done

  fail "Timed out waiting for ${url}"
}

main() {
  parse_args "$@"
  [[ "${FA_ENVIRONMENT}" == "prod" ]] || fail "FA_ENVIRONMENT must be prod"
  [[ -n "${deploy_sha}" ]] || fail "--sha is required"
  [[ -r "${FA_PROD_ENV_FILE}" ]] || fail "Env file is not readable: ${FA_PROD_ENV_FILE}"
  [[ -r "${FA_HETZNER_RUNTIME_KEY_FILE}" ]] || fail "Runtime key is not readable: ${FA_HETZNER_RUNTIME_KEY_FILE}"
  command -v docker >/dev/null 2>&1 || fail "docker is required"
  command -v curl >/dev/null 2>&1 || fail "curl is required"

  docker rm -f "${container_name}" >/dev/null 2>&1 || true
  docker run -d \
    --name fa-services \
    --restart unless-stopped \
    --env-file "${FA_PROD_ENV_FILE}" \
    -e FA_PROD_ENV_FILE="${FA_PROD_ENV_FILE}" \
    -e FA_RELEASE_SHA="${deploy_sha}" \
    -v "${FA_PROD_ENV_FILE}:${FA_PROD_ENV_FILE}:ro" \
    -v "${FA_HETZNER_RUNTIME_KEY_FILE}:/run/secrets/fa-runtime-sa-key.json:ro" \
    -p 127.0.0.1:3201:3201 \
    -p 127.0.0.1:3202:3202 \
    -p 127.0.0.1:3203:3203 \
    -p 127.0.0.1:3204:3204 \
    "fa-services:${deploy_sha}"

  wait_for_health http://127.0.0.1:3201/health
  wait_for_health http://127.0.0.1:3202/health
  wait_for_health http://127.0.0.1:3203/health
  wait_for_health http://127.0.0.1:3204/health
  docker ps --filter "name=${container_name}"
}

main "$@"

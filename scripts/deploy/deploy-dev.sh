#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

branch=""
deploy_sha=""
FA_DEV_REPO_PATH="${FA_DEV_REPO_PATH:-${HOME}/deploy/fishing-assistant}"
FA_DEV_ORIGIN="${FA_DEV_ORIGIN:-https://dev.fishing-assistant.online}"
FA_DEV_PUBLIC_ORIGIN="${FA_DEV_PUBLIC_ORIGIN:-https://dev.fishing-assistant.online}"
FA_DEV_HOSTNAME="${FA_DEV_HOSTNAME:-dev-host}"
FA_DEV_ALLOW_NON_DEV_HOST="${FA_DEV_ALLOW_NON_DEV_HOST:-}"
remote_url="${FA_DEV_REMOTE_URL:-https://github.com/pbuchman/fishing-assistant.git}"
source_repo="${FA_DEV_SOURCE_REPO:-}"
FA_PM2_HOME="${FA_PM2_HOME:-${HOME}/.pm2-fa}"

usage() {
  printf 'Usage: %s --branch <branch> --sha <commit-sha>\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --branch)
        shift
        [[ $# -gt 0 ]] || fail "--branch requires a value"
        branch="$1"
        shift
        ;;
      --branch=*)
        branch="${1#*=}"
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

wait_for_edge_health() {
  local url="$1"
  local deadline=$((SECONDS + 90))
  local curl_args=(--fail --silent --show-error --max-time 5)

  while ((SECONDS < deadline)); do
    if curl "${curl_args[@]}" "${url}" >/dev/null; then
      return 0
    fi
    sleep 3
  done

  fail "Timed out waiting for ${url}"
}

ensure_dev_env_files() {
  [[ -f .envrc ]] || fail "DEV deploy clone is missing .envrc; copy .envrc.example to .envrc and run direnv allow"
  [[ -f .env.dev.local ]] ||
    fail "DEV deploy clone is missing .env.dev.local; copy .env.dev.example to .env.dev.local and fill local secrets"
}

normalize_origin() {
  printf '%s' "${1%/}"
}

assert_public_dev_host() {
  local actual_hostname

  if [[ "$(normalize_origin "${FA_DEV_ORIGIN}")" != "$(normalize_origin "${FA_DEV_PUBLIC_ORIGIN}")" ]]; then
    return
  fi

  if [[ "${FA_DEV_ALLOW_NON_DEV_HOST}" == "1" ]]; then
    return
  fi

  actual_hostname="$(hostname -s 2>/dev/null || hostname 2>/dev/null || printf 'unknown')"
  [[ "${actual_hostname}" == "${FA_DEV_HOSTNAME}" ]] ||
    fail "Public DEV deploys must run on ${FA_DEV_HOSTNAME}; current host is ${actual_hostname}. SSH to ${FA_DEV_HOSTNAME} or set FA_DEV_ALLOW_NON_DEV_HOST=1 only for intentional non-public testing."
}

run_fa_pm2() {
  PM2_HOME="${FA_PM2_HOME}" env -u PORT direnv exec . pnpm exec pm2 "$@"
}

resolve_source_repo() {
  if [[ -n "${source_repo}" ]]; then
    return
  fi

  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    source_repo="$(git rev-parse --show-toplevel)"
  else
    source_repo="${remote_url}"
  fi
}

ensure_deploy_clone() {
  if [[ -d "${FA_DEV_REPO_PATH}/.git" ]]; then
    return
  fi

  mkdir -p "$(dirname "${FA_DEV_REPO_PATH}")"
  git clone "${remote_url}" "${FA_DEV_REPO_PATH}"
}

fetch_target() {
  git -C "${FA_DEV_REPO_PATH}" remote set-url origin "${remote_url}" || true
  if ! git -C "${FA_DEV_REPO_PATH}" fetch --prune "${source_repo}" "${branch}"; then
    git -C "${FA_DEV_REPO_PATH}" fetch --prune origin "${branch}"
  fi

  if ! git -C "${FA_DEV_REPO_PATH}" cat-file -e "${deploy_sha}^{commit}"; then
    fail "Commit ${deploy_sha} is not available in ${FA_DEV_REPO_PATH}"
  fi
}

deploy_commit() {
  local previous_sha=""

  previous_sha="$(git -C "${FA_DEV_REPO_PATH}" rev-parse HEAD 2>/dev/null || true)"
  git -C "${FA_DEV_REPO_PATH}" reset --hard "${deploy_sha}"
  git -C "${FA_DEV_REPO_PATH}" clean -df

  cd "${FA_DEV_REPO_PATH}"
  ensure_dev_env_files
  direnv exec . pnpm install --frozen-lockfile
  direnv exec . pnpm run generate:service-wiring
  direnv exec . pnpm run verify:service-wiring
  direnv exec . pnpm run verify:env
  direnv exec . pnpm run verify:data-baseline
  direnv exec . pnpm run build
  mkdir -p "${FA_PM2_HOME}"
  run_fa_pm2 startOrReload ecosystem.config.cjs --update-env
  run_fa_pm2 save
  wait_for_health http://127.0.0.1:3201/health
  wait_for_health http://127.0.0.1:3202/health
  wait_for_health http://127.0.0.1:3203/health
  wait_for_health http://127.0.0.1:3204/health
  wait_for_edge_health "${FA_DEV_ORIGIN}/api/chat/health"
  wait_for_edge_health "${FA_DEV_ORIGIN}/api/knowledge/health"
  wait_for_edge_health "${FA_DEV_ORIGIN}/api/llm-usage/health"
  wait_for_edge_health "${FA_DEV_ORIGIN}/api/users/health"
  FA_DEV_ORIGIN="${FA_DEV_ORIGIN}" direnv exec . node scripts/smoke/e2e-dev.mjs
  direnv exec . node scripts/smoke/auth0-authorize-preflight.mjs

  printf '{"status":"deployed","environment":"dev","branch":"%s","sha":"%s","previousSha":"%s"}\n' \
    "${branch}" \
    "${deploy_sha}" \
    "${previous_sha}"
}

main() {
  parse_args "$@"
  [[ -n "${branch}" ]] || fail "--branch is required"
  [[ -n "${deploy_sha}" ]] || fail "--sha is required"
  require_command git
  require_command curl
  require_command direnv
  require_command pnpm
  assert_public_dev_host
  resolve_source_repo
  ensure_deploy_clone
  fetch_target
  deploy_commit
}

main "$@"

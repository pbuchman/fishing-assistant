#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

branch=""
deploy_sha=""
mode="deploy"
latest_main=0
FA_DEV_STATE_DIR="${FA_DEV_STATE_DIR:-${HOME}/.local/state/fishing-assistant/deploy}"
FA_DEV_REPO_PATH="${FA_DEV_REPO_PATH:-${HOME}/deploy/fishing-assistant}"
FA_DEV_ORIGIN="${FA_DEV_ORIGIN:-https://dev.fishing-assistant.online}"
FA_DEV_PUBLIC_ORIGIN="${FA_DEV_PUBLIC_ORIGIN:-https://dev.fishing-assistant.online}"
FA_DEV_HOSTNAME="${FA_DEV_HOSTNAME:-home-dev}"
FA_DEV_ALLOW_NON_DEV_HOST="${FA_DEV_ALLOW_NON_DEV_HOST:-}"
remote_url="${FA_DEV_REMOTE_URL:-https://github.com/pbuchman/fishing-assistant.git}"
source_repo="${FA_DEV_SOURCE_REPO:-}"
FA_PM2_HOME="${FA_PM2_HOME:-${HOME}/.pm2-fa}"

usage() {
  printf 'Usage: %s --branch <branch> --sha <commit-sha> [--prepare-only|--activate-only] | --latest-main\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prepare-only) mode="prepare"; shift ;;
      --activate-only) mode="activate"; shift ;;
      --latest-main) latest_main=1; branch="main"; shift ;;
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
  PM2_HOME="${FA_PM2_HOME}" env -u PORT direnv exec . pnpm exec pm2 "$@" 9>&-
}

resolve_source_repo() {
  source_repo="${source_repo:-${remote_url}}"
}

ensure_deploy_clone() {
  if [[ -d "${FA_DEV_REPO_PATH}/.git" ]]; then
    return
  fi

  mkdir -p "$(dirname "${FA_DEV_REPO_PATH}")"
  git clone "${remote_url}" "${FA_DEV_REPO_PATH}"
}

fetch_target() {
  [[ -z "$(git -C "${FA_DEV_REPO_PATH}" status --porcelain)" ]] ||
    fail "Deploy checkout has uncommitted or untracked files; preserve them before retrying"
  git -C "${FA_DEV_REPO_PATH}" remote set-url origin "${remote_url}"
  git -C "${FA_DEV_REPO_PATH}" fetch --no-tags "${source_repo}" "${branch}"
  if [[ "${latest_main}" == "1" ]]; then
    deploy_sha="$(git -C "${FA_DEV_REPO_PATH}" rev-parse FETCH_HEAD)"
    if [[ -f "${FA_DEV_STATE_DIR}/active-sha" ]]; then
      local active_sha
      active_sha="$(cat "${FA_DEV_STATE_DIR}/active-sha")"
      [[ "${active_sha}" =~ ^[a-f0-9]{40}$ ]] || fail "Invalid active release record"
      git -C "${FA_DEV_REPO_PATH}" merge-base --is-ancestor "${active_sha}" "${deploy_sha}" ||
        fail "Automatic deployment would move backwards or change release history"
    fi
  fi
  git -C "${FA_DEV_REPO_PATH}" merge-base --is-ancestor "${deploy_sha}" FETCH_HEAD ||
    fail "Requested commit is not on the fetched branch"
}

stage() {
  printf 'FA deploy job=%s stage=%s sha=%s\n' "${FA_DEV_JOB_ID:-manual}" "$1" "${deploy_sha}" >&2
}

deploy_commit() {
  local previous_sha=""

  previous_sha="$(git -C "${FA_DEV_REPO_PATH}" rev-parse HEAD 2>/dev/null || true)"
  git -C "${FA_DEV_REPO_PATH}" reset --hard "${deploy_sha}"
  # Ignored configuration stays in place; untracked files were rejected before reset.

  cd "${FA_DEV_REPO_PATH}"
  ensure_dev_env_files
  direnv exec . node scripts/dev-setup.mjs
  stage install
  direnv exec . pnpm install --frozen-lockfile
  direnv exec . pnpm run generate:service-wiring
  direnv exec . pnpm run verify:service-wiring
  direnv exec . pnpm run verify:env
  direnv exec . pnpm run verify:static
  direnv exec . pnpm run verify:observability
  direnv exec . pnpm run verify:data-baseline
  stage build
  direnv exec . pnpm run build
  node scripts/dev-host/release-state.mjs prepare "${deploy_sha}" "${FA_DEV_STATE_DIR}"
  if [[ "${mode}" == "prepare" ]]; then
    printf '{"status":"prepared","sha":"%s"}\n' "${deploy_sha}"
    return
  fi
  activate_commit
}

activate_commit() {
  cd "${FA_DEV_REPO_PATH}"
  direnv exec . node scripts/dev-setup.mjs
  node scripts/dev-host/release-state.mjs verify "${deploy_sha}" "${FA_DEV_STATE_DIR}"
  stage activate
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
  run_fa_pm2 jlist | node scripts/dev-host/verify-dev-processes.mjs "${FA_DEV_REPO_PATH}"
  curl --fail --silent --show-error "${FA_DEV_ORIGIN}/version.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const v=JSON.parse(s);if(v.repository!=="pbuchman/fishing-assistant"||v.sha!==process.argv[1])process.exit(1)})' "${deploy_sha}"

  printf '%s\n' "${deploy_sha}" > "${FA_DEV_STATE_DIR}/active-sha.tmp"
  mv "${FA_DEV_STATE_DIR}/active-sha.tmp" "${FA_DEV_STATE_DIR}/active-sha"
  stage completed
  printf '{"status":"deployed","environment":"dev","branch":"%s","sha":"%s","previousSha":"%s"}\n' \
    "${branch}" \
    "${deploy_sha}" \
    "${previous_sha:-}"
}

main() {
  parse_args "$@"
  if [[ "${latest_main}" == "1" ]]; then
    branch=main
    remote_url=https://github.com/pbuchman/fishing-assistant.git
    source_repo="${remote_url}"
  fi
  [[ -n "${branch}" ]] || fail "--branch is required"
  [[ "${latest_main}" == "1" || "${deploy_sha}" =~ ^[a-f0-9]{40}$ ]] || fail "--sha must be a full commit SHA"
  git check-ref-format --branch "${branch}" >/dev/null || fail "Invalid branch"
  require_command git
  require_command curl
  require_command direnv
  require_command pnpm
  require_command node
  require_command flock
  require_command lsof
  [[ "$(pnpm --version)" == "10.29.3" ]] || fail "pnpm 10.29.3 is required"
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<12))process.exit(1)' || fail "Node >=22.12 is required"
  mkdir -p "${FA_DEV_STATE_DIR}"
  chmod 700 "${FA_DEV_STATE_DIR}"
  exec 9>"${FA_DEV_STATE_DIR}/deploy.lock"
  flock -x 9
  assert_public_dev_host
  resolve_source_repo
  ensure_deploy_clone
  (cd "${FA_DEV_REPO_PATH}"; ensure_dev_env_files)
  if [[ "${mode}" == "activate" ]]; then
    [[ "${latest_main}" == "0" ]] || fail "Activation requires the prepared SHA"
    activate_commit
  else
    fetch_target
    deploy_commit
  fi
}

main "$@"

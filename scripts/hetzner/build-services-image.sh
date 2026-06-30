#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${SCRIPT_DIR}/../.." && pwd)"
deploy_sha="${FA_DEPLOY_SHA:-}"
FA_ENVIRONMENT="${FA_ENVIRONMENT:-}"

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

prune_docker_build_space() {
  printf 'Docker disk usage before cleanup:\n'
  docker system df
  docker container prune -f
  docker image prune -af
  docker builder prune -af
  printf 'Docker disk usage after cleanup:\n'
  docker system df
}

main() {
  parse_args "$@"
  [[ "${FA_ENVIRONMENT}" == "prod" ]] || fail "FA_ENVIRONMENT must be prod"
  [[ -n "${deploy_sha}" ]] || fail "--sha is required"
  command -v docker >/dev/null 2>&1 || fail "docker is required"

  cd "${repo_dir}"
  prune_docker_build_space
  docker build -f docker/prod/Dockerfile -t "fa-services:${deploy_sha}" .
  docker image tag "fa-services:${deploy_sha}" fa-services:latest
}

main "$@"

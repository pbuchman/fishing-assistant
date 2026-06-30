#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_pm2_home="${FA_LOCAL_PM2_HOME:-${repo_root}/.cache/pm2-local}"

mkdir -p "${local_pm2_home}"

cd "${repo_root}"
exec env -u PORT direnv exec . env \
  FA_PM2_HOME="${local_pm2_home}" \
  PM2_HOME="${local_pm2_home}" \
  pnpm exec pm2 "$@"

#!/usr/bin/env bash
set -euo pipefail
cd "${FA_DEV_REPO_PATH:?FA_DEV_REPO_PATH is required}"
sha="$(git rev-parse HEAD)"
exec bash scripts/deploy/deploy-dev.sh --branch main --sha "${sha}" --activate-only

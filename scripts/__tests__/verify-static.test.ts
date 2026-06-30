import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateStaticRepository } from '../verify-static.mjs';

const prodLoadSecretsWrapperCall =
  'sudo -n /usr/local/sbin/fa-load-secrets --auth0-domain "${FA_AUTH0_DOMAIN}" --auth0-client-id "${FA_AUTH0_CLIENT_ID}" --auth0-audience "${FA_AUTH0_AUDIENCE}" "${release_dir}"';
const foreignProductEnv = ['OTHERPRODUCT', 'ENVIRONMENT'].join('_');
const foreignProductTokenEnv = ['OTHERPRODUCT', 'TOKEN'].join('_');

const deployWorkflowWithProdMainAncestryCheck = [
  'name: deploy',
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      bootstrap_origin_http_only:',
  '        description: Bootstrap the production origin over HTTP before Cloudflare DNS/TLS is ready',
  '        type: boolean',
  '        required: false',
  '        default: false',
  '      allow_unmerged_prod_ref:',
  '        description: Allow temporary production deploys from refs not merged to main',
  '        type: boolean',
  '        required: false',
  '        default: false',
  'jobs:',
  '  deploy:',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  "          ref: ${{ inputs.ref || 'main' }}",
  '          fetch-depth: 0',
  '      - name: Require PROD deploy ref on main',
  "        if: ${{ inputs.environment == 'prod' && inputs.allow_unmerged_prod_ref != true }}",
  '        run: |',
  '          deploy_sha="$(git rev-parse HEAD)"',
  '          git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main',
  '          main_sha="$(git rev-parse --verify refs/remotes/origin/main)"',
  '          if ! git merge-base --is-ancestor "$deploy_sha" "$main_sha"; then',
  '            echo "::error::PROD deploy ref ${deploy_sha} is not an ancestor of origin/main (${main_sha})."',
  '            exit 1',
  '          fi',
  '      - name: Deploy PROD to Hetzner',
  "        if: ${{ inputs.environment == 'prod' }}",
  '        env:',
  '          FA_DEPLOY_SHA: ${{ steps.sha.outputs.sha }}',
  '          FA_HETZNER_PROD_HOST_KEY_SHA256: ${{ secrets.FA_HETZNER_PROD_HOST_KEY_SHA256 }}',
  '          FA_AUTH0_DOMAIN: ${{ vars.FA_AUTH0_DOMAIN }}',
  '          FA_AUTH0_CLIENT_ID: ${{ vars.FA_AUTH0_CLIENT_ID }}',
  '          FA_AUTH0_AUDIENCE: ${{ vars.FA_AUTH0_AUDIENCE }}',
  '        run: |',
  '          args=(--sha "$FA_DEPLOY_SHA")',
  '          if [[ "${{ inputs.bootstrap_origin_http_only }}" == "true" ]]; then',
  '            args+=(--bootstrap-origin-http-only)',
  '          fi',
  '          bash scripts/hetzner/github-actions-deploy.sh "${args[@]}"',
  '',
].join('\n');

const githubActionsDeployWithPinnedHostTrust = [
  '#!/usr/bin/env bash',
  'FA_HETZNER_PROD_HOST_KEY_SHA256="${FA_HETZNER_PROD_HOST_KEY_SHA256:-}"',
  'FA_HETZNER_PROD_HOST="${FA_HETZNER_PROD_HOST:-}"',
  'FA_AUTH0_DOMAIN="${FA_AUTH0_DOMAIN:-}"',
  'FA_AUTH0_CLIENT_ID="${FA_AUTH0_CLIENT_ID:-}"',
  'FA_AUTH0_AUDIENCE="${FA_AUTH0_AUDIENCE:-}"',
  'FA_PROD_DOMAIN="${FA_PROD_DOMAIN:-fishing-assistant.online}"',
  'FA_HETZNER_SSH_PORT="${FA_HETZNER_SSH_PORT:-22}"',
  'deploy_nginx="${FA_DEPLOY_NGINX:-false}"',
  'deploy_bootstrap_origin_http_only=false',
  'known_hosts_file="$(mktemp)"',
  'temp_scan_file="$(mktemp)"',
  'require_command() { command -v "$1" >/dev/null 2>&1; }',
  'parse_args() {',
  '  while [[ $# -gt 0 ]]; do',
  '    case "$1" in',
  '      --deploy-nginx) deploy_nginx=true; shift ;;',
  '      --bootstrap-origin-http-only) deploy_bootstrap_origin_http_only=true; shift ;;',
  '      *) shift ;;',
  '    esac',
  '  done',
  '}',
  'validate_inputs() {',
  '  case "${deploy_nginx}" in true|false) ;; *) exit 1 ;; esac',
  '  case "${deploy_bootstrap_origin_http_only}" in true|false) ;; *) exit 1 ;; esac',
  '  [[ -n "${FA_AUTH0_DOMAIN}" ]] || fail "FA_AUTH0_DOMAIN is required"',
  '  [[ -n "${FA_AUTH0_CLIENT_ID}" ]] || fail "FA_AUTH0_CLIENT_ID is required"',
  '  [[ -n "${FA_AUTH0_AUDIENCE}" ]] || fail "FA_AUTH0_AUDIENCE is required"',
  '}',
  'verify_auth0_authorize_preflight() {',
  '  FA_PUBLIC_ORIGIN="https://${FA_PROD_DOMAIN}" node scripts/smoke/auth0-authorize-preflight.mjs',
  '}',
  'require_command ssh-keygen',
  'verify_auth0_authorize_preflight',
  'ssh-keyscan -p "${FA_HETZNER_SSH_PORT}" -H "${FA_HETZNER_PROD_HOST}" > "${temp_scan_file}"',
  'while IFS= read -r key_line; do',
  '  fingerprint_line="$(printf "%s\\n" "${key_line}" | ssh-keygen -lf -)"',
  '  read -r _bits fingerprint _rest <<< "${fingerprint_line}"',
  '  if [[ "${fingerprint}" == "${FA_HETZNER_PROD_HOST_KEY_SHA256}" ]]; then',
  '    printf "%s\\n" "${key_line}" > "${known_hosts_file}"',
  '  fi',
  'done < "${temp_scan_file}"',
  'ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${known_hosts_file}" deploy@example true',
  'rsync -e "ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${known_hosts_file}" ./ deploy@example:/tmp',
  'release_dir="/opt/fishing-assistant/releases/abc123"',
  prodLoadSecretsWrapperCall,
  'sudo -n /usr/local/sbin/fa-deploy-nginx "${release_dir}"',
  'sudo -n /usr/local/sbin/fa-load-observability-env "${release_dir}" "https://grafana.example" "logs" "https://fishing-assistant.online/alerts/grafana"',
  'sudo -n /usr/local/sbin/fa-install-observability "${release_dir}" "abc123" --with-alert-router',
  'assert_remote_http_200() {',
  '  local url="$1"',
  '  run_remote "status=\\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out \'%{http_code}\' ${url}); [[ \\"\\${status}\\" == \\"200\\" ]]"',
  '}',
  'assert_remote_http_status() {',
  '  local url="$1"',
  '  local expected_status="$2"',
  '  local header="${3:-}"',
  '  run_remote "status=\\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out \'%{http_code}\' ${url}); [[ \\"\\${status}\\" == \\"${expected_status}\\" ]]"',
  '}',
  'assert_remote_https_origin_http_200() {',
  '  local path="$1"',
  '  local resolve_arg=""',
  '  local url=""',
  '  printf -v resolve_arg \'%q\' "${FA_PROD_DOMAIN}:443:127.0.0.1"',
  '  printf -v url \'%q\' "https://${FA_PROD_DOMAIN}${path}"',
  '  run_remote "status=\\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out \'%{http_code}\' --resolve ${resolve_arg} ${url}); [[ \\"\\${status}\\" == \\"200\\" ]]"',
  '}',
  'assert_remote_https_origin_http_status() {',
  '  local path="$1"',
  '  local expected_status="$2"',
  '  local header="${3:-}"',
  '  local resolve_arg=""',
  '  local url=""',
  '  printf -v resolve_arg \'%q\' "${FA_PROD_DOMAIN}:443:127.0.0.1"',
  '  printf -v url \'%q\' "https://${FA_PROD_DOMAIN}${path}"',
  '  run_remote "status=\\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out \'%{http_code}\' --resolve ${resolve_arg} ${url}); [[ \\"\\${status}\\" == \\"${expected_status}\\" ]]"',
  '}',
  'assert_https_edge_http_200() {',
  '  local path="$1"',
  '  local status=""',
  '  status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out \'%{http_code}\' --resolve "${FA_PROD_DOMAIN}:443:${FA_HETZNER_PROD_HOST}" "https://${FA_PROD_DOMAIN}${path}")"',
  '  [[ "${status}" == "200" ]]',
  '}',
  'assert_https_edge_http_status() {',
  '  local path="$1"',
  '  local expected_status="$2"',
  '  local header="${3:-}"',
  '  local status=""',
  '  status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out \'%{http_code}\' --resolve "${FA_PROD_DOMAIN}:443:${FA_HETZNER_PROD_HOST}" "https://${FA_PROD_DOMAIN}${path}")"',
  '  [[ "${status}" == "${expected_status}" ]]',
  '}',
  'verify_service_health() {',
  '  assert_remote_http_200 http://127.0.0.1:3201/health',
  '  assert_remote_http_200 http://127.0.0.1:3202/health',
  '  assert_remote_http_200 http://127.0.0.1:3203/health',
  '}',
  'verify_local_origin_health() {',
  '  if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]; then',
  '    assert_remote_http_200 http://127.0.0.1/healthz',
  '    assert_remote_http_200 http://127.0.0.1/',
  '    assert_remote_http_200 http://127.0.0.1/index.html',
  '    assert_remote_http_200 http://127.0.0.1/app',
  '    assert_remote_http_200 http://127.0.0.1/api/chat/health',
  '    assert_remote_http_200 http://127.0.0.1/api/knowledge/health',
  '    assert_remote_http_200 http://127.0.0.1/api/llm-usage/health',
  '    assert_remote_http_200 http://127.0.0.1/api/users/health',
  '  else',
  '    assert_remote_https_origin_http_200 /healthz',
  '    verify_local_origin_public_entrypoints',
  '  fi',
  '}',
  'verify_local_origin_public_entrypoints() {',
  '  assert_remote_https_origin_http_200 /',
  '  assert_remote_https_origin_http_200 /index.html',
  '  assert_remote_https_origin_http_200 /app',
  '  assert_remote_https_origin_http_200 /api/chat/health',
  '  assert_remote_https_origin_http_200 /api/knowledge/health',
  '  assert_remote_https_origin_http_200 /api/llm-usage/health',
  '  assert_remote_https_origin_http_200 /api/users/health',
  '}',
  'verify_https_edge_public_entrypoints() {',
  '  assert_https_edge_http_200 /',
  '  assert_https_edge_http_200 /index.html',
  '  assert_https_edge_http_200 /app',
  '  assert_https_edge_http_200 /api/chat/health',
  '  assert_https_edge_http_200 /api/knowledge/health',
  '  assert_https_edge_http_200 /api/llm-usage/health',
  '  assert_https_edge_http_200 /api/users/health',
  '}',
  'verify_https_edge_health() {',
  '  assert_https_edge_http_200 /healthz',
  '  verify_https_edge_public_entrypoints',
  '}',
  'verify_deployment() {',
  '  verify_service_health',
  '  verify_observability_health',
  '  verify_local_origin_health',
  '  if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]; then',
  '    printf "Skipping HTTPS edge health checks for bootstrap origin HTTP mode\\n"',
  '  else',
  '    verify_https_edge_health',
  '  fi',
  '}',
  'verify_observability_health() {',
  '  run_remote "systemctl is-active --quiet fa-alloy"',
  '  run_remote "systemctl is-active --quiet fa-alert-router"',
  '  assert_remote_http_200 http://127.0.0.1:9002/health',
  '}',
  '',
].join('\n');

const provisionWithNarrowSudoWrappers = [
  '#!/usr/bin/env bash',
  'deploy_user="deploy"',
  'app_root="/opt/fishing-assistant"',
  'useradd --create-home --shell /bin/bash "${deploy_user}"',
  'usermod -aG docker "${deploy_user}"',
  'install -d -o root -g deploy -m 750 /etc/fa',
  'test -e /etc/fa/observability.env || install -o root -g deploy -m 0640 /dev/null /etc/fa/observability.env',
  "install -m 755 -o root -g root /dev/stdin /usr/local/sbin/fa-load-secrets <<'WRAPPER'",
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'release_dir="$(realpath -e "$1")"',
  'case "${release_dir}" in',
  '  /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '  *) exit 1 ;;',
  'esac',
  '[[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1',
  'export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"',
  'FA_PROD_OPENROUTER_APP_API_KEY=FA_OPENROUTER_APP_API_KEY',
  'FA_PROD_MINIMAX_APP_API_KEY=FA_MINIMAX_APP_API_KEY',
  'gcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN --project="${FA_GCP_PROJECT_ID}" >/tmp/fa-prod-env',
  'install -m 640 -o root -g "${deploy_user}" /tmp/fa-prod-env /etc/fa/.env.prod',
  'WRAPPER',
  "install -m 755 -o root -g root /dev/stdin /usr/local/sbin/fa-deploy-nginx <<'WRAPPER'",
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'release_dir="$(realpath -e "$1")"',
  'case "${release_dir}" in',
  '  /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '  *) exit 1 ;;',
  'esac',
  'config_source="${release_dir}/scripts/hetzner/nginx/fishing-assistant.conf"',
  'real_source="$(realpath -e "${config_source}")"',
  'real_source_dir="$(dirname "${real_source}")"',
  'source_name="$(basename "${real_source}")"',
  '[[ "${real_source_dir}" == "${release_dir}/scripts/hetzner/nginx" ]] || exit 1',
  'case "${source_name}" in fishing-assistant.conf|fishing-assistant.origin-http.conf) ;; *) exit 1 ;; esac',
  'install -m 644 -o root -g root "${real_source}" "/etc/nginx/sites-available/fishing-assistant.conf"',
  'nginx -t',
  'WRAPPER',
  "install -m 755 -o root -g root /dev/stdin /usr/local/sbin/fa-load-observability-env <<'WRAPPER'",
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'release_dir="$(realpath -e "$1")"',
  'case "${release_dir}" in',
  '  /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '  *) exit 1 ;;',
  'esac',
  'FA_ENVIRONMENT=prod bash "${release_dir}/scripts/hetzner/load-observability-env.sh"',
  'WRAPPER',
  "install -m 755 -o root -g root /dev/stdin /usr/local/sbin/fa-install-observability <<'WRAPPER'",
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'release_dir="$(realpath -e "$1")"',
  'case "${release_dir}" in',
  '  /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '  *) exit 1 ;;',
  'esac',
  'FA_ENVIRONMENT=prod bash "${release_dir}/scripts/hetzner/install-observability.sh" --sha "$2" --with-alert-router',
  'WRAPPER',
  'printf \'%s\\n\' "${deploy_user} ALL=(root) NOPASSWD: /usr/local/sbin/fa-load-secrets *, /usr/local/sbin/fa-deploy-nginx *, /usr/local/sbin/fa-load-observability-env *, /usr/local/sbin/fa-install-observability *" > "/etc/sudoers.d/90-fa-${deploy_user}"',
  '',
].join('\n');

const cloudInitWithNarrowSudoWrappers = [
  '#cloud-config',
  'users:',
  '  - name: deploy',
  '    shell: /bin/bash',
  '    groups: [docker]',
  '    sudo: "ALL=(root) NOPASSWD: /usr/local/sbin/fa-load-secrets *, /usr/local/sbin/fa-deploy-nginx *, /usr/local/sbin/fa-load-observability-env *, /usr/local/sbin/fa-install-observability *"',
  '    ssh_authorized_keys:',
  '      - ${deploy_ssh_public_key}',
  'write_files:',
  '  - path: /usr/local/sbin/fa-load-secrets',
  '    owner: root:root',
  '    permissions: "0755"',
  '    content: |',
  '      #!/usr/bin/env bash',
  '      set -euo pipefail',
  '      release_dir="$(realpath -e "$1")"',
  '      case "${release_dir}" in',
  '        /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '        *) exit 1 ;;',
  '      esac',
  '      [[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1',
  '      export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"',
  '      FA_PROD_OPENROUTER_APP_API_KEY=FA_OPENROUTER_APP_API_KEY',
  '      FA_PROD_MINIMAX_APP_API_KEY=FA_MINIMAX_APP_API_KEY',
  '      gcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN --project="${FA_GCP_PROJECT_ID}" >/tmp/fa-prod-env',
  '      install -m 640 -o root -g deploy /tmp/fa-prod-env /etc/fa/.env.prod',
  '  - path: /usr/local/sbin/fa-deploy-nginx',
  '    owner: root:root',
  '    permissions: "0755"',
  '    content: |',
  '      #!/usr/bin/env bash',
  '      set -euo pipefail',
  '      release_dir="$(realpath -e "$1")"',
  '      case "${release_dir}" in',
  '        /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '        *) exit 1 ;;',
  '      esac',
  '      config_source="${release_dir}/scripts/hetzner/nginx/fishing-assistant.conf"',
  '      real_source="$(realpath -e "${config_source}")"',
  '      real_source_dir="$(dirname "${real_source}")"',
  '      source_name="$(basename "${real_source}")"',
  '      [[ "${real_source_dir}" == "${release_dir}/scripts/hetzner/nginx" ]] || exit 1',
  '      case "${source_name}" in fishing-assistant.conf|fishing-assistant.origin-http.conf) ;; *) exit 1 ;; esac',
  '      install -m 644 -o root -g root "${real_source}" "/etc/nginx/sites-available/fishing-assistant.conf"',
  '      nginx -t',
  '  - path: /usr/local/sbin/fa-load-observability-env',
  '    owner: root:root',
  '    permissions: "0755"',
  '    content: |',
  '      #!/usr/bin/env bash',
  '      set -euo pipefail',
  '      release_dir="$(realpath -e "$1")"',
  '      case "${release_dir}" in',
  '        /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '        *) exit 1 ;;',
  '      esac',
  '      FA_ENVIRONMENT=prod bash "${release_dir}/scripts/hetzner/load-observability-env.sh"',
  '  - path: /usr/local/sbin/fa-install-observability',
  '    owner: root:root',
  '    permissions: "0755"',
  '    content: |',
  '      #!/usr/bin/env bash',
  '      set -euo pipefail',
  '      release_dir="$(realpath -e "$1")"',
  '      case "${release_dir}" in',
  '        /opt/fishing-assistant/current|/opt/fishing-assistant/releases/*) ;;',
  '        *) exit 1 ;;',
  '      esac',
  '      FA_ENVIRONMENT=prod bash "${release_dir}/scripts/hetzner/install-observability.sh" --sha "$2" --with-alert-router',
  'runcmd:',
  '  - test -e /etc/fa/observability.env || install -o root -g deploy -m 0640 /dev/null /etc/fa/observability.env',
  '',
].join('\n');

const provisionWithDeployOwnedScriptExecution = provisionWithNarrowSudoWrappers
  .replace(
    '[[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1\nexport CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"\ngcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN --project="${FA_GCP_PROJECT_ID}" >/tmp/fa-prod-env\ninstall -m 640 -o root -g "${deploy_user}" /tmp/fa-prod-env /etc/fa/.env.prod',
    'cd "${release_dir}" && FA_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
  )
  .replace(
    'config_source="${release_dir}/scripts/hetzner/nginx/fishing-assistant.conf"\nreal_source="$(realpath -e "${config_source}")"\nreal_source_dir="$(dirname "${real_source}")"\nsource_name="$(basename "${real_source}")"\n[[ "${real_source_dir}" == "${release_dir}/scripts/hetzner/nginx" ]] || exit 1\ncase "${source_name}" in fishing-assistant.conf|fishing-assistant.origin-http.conf) ;; *) exit 1 ;; esac\ninstall -m 644 -o root -g root "${real_source}" "/etc/nginx/sites-available/fishing-assistant.conf"\nnginx -t',
    'cd "${release_dir}" && FA_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
  );

const cloudInitWithDeployOwnedScriptExecution = cloudInitWithNarrowSudoWrappers
  .replace(
    '      [[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1\n      export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"\n      gcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN --project="${FA_GCP_PROJECT_ID}" >/tmp/fa-prod-env\n      install -m 640 -o root -g deploy /tmp/fa-prod-env /etc/fa/.env.prod',
    '      cd "${release_dir}" && FA_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
  )
  .replace(
    '      config_source="${release_dir}/scripts/hetzner/nginx/fishing-assistant.conf"\n      real_source="$(realpath -e "${config_source}")"\n      real_source_dir="$(dirname "${real_source}")"\n      source_name="$(basename "${real_source}")"\n      [[ "${real_source_dir}" == "${release_dir}/scripts/hetzner/nginx" ]] || exit 1\n      case "${source_name}" in fishing-assistant.conf|fishing-assistant.origin-http.conf) ;; *) exit 1 ;; esac\n      install -m 644 -o root -g root "${real_source}" "/etc/nginx/sites-available/fishing-assistant.conf"\n      nginx -t',
    '      cd "${release_dir}" && FA_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
  );

const provisionWithUncanonicalizedNginxSource = provisionWithNarrowSudoWrappers.replace(
  'real_source="$(realpath -e "${config_source}")"',
  'real_source="${config_source}"'
);

const cloudInitWithUncanonicalizedNginxSource = cloudInitWithNarrowSudoWrappers.replace(
  '      real_source="$(realpath -e "${config_source}")"',
  '      real_source="${config_source}"'
);

const terraformGcpDataPlaneWithProvisioningDnsToken = [
  'locals {',
  '  runtime_secret_names = toset([',
  '    "FA_INTERNAL_AUTH_TOKEN",',
  '    "FA_DEV_OPENROUTER_APP_API_KEY",',
  '    "FA_DEV_MINIMAX_APP_API_KEY",',
  '    "FA_OPENROUTER_APP_API_KEY",',
  '    "FA_OPENAI_APP_API_KEY",',
  '    "FA_PROD_OPENROUTER_APP_API_KEY",',
  '    "FA_PROD_MINIMAX_APP_API_KEY",',
  '    "FA_GEMINI_APP_API_KEY",',
  '  ])',
  '',
  '  provisioning_secret_names = toset([',
  '    "FA_CLOUDFLARE_DNS_API_TOKEN",',
  '    "FA_GRAFANA_LOKI_URL",',
  '    "FA_GRAFANA_LOKI_USERNAME",',
  '    "FA_GRAFANA_LOKI_TOKEN",',
  '    "FA_ALERT_ROUTER_WEBHOOK_SECRET",',
  '    "FA_ALERT_ROUTER_GITHUB_TOKEN",',
  '  ])',
  '}',
  '',
  'resource "google_service_account" "automation_admin" {',
  '  account_id = "fa-admin"',
  '}',
  '',
  'resource "google_service_account" "hetzner_provisioner" {',
  '  account_id = "fa-hetzner-provisioner"',
  '}',
  '',
  'resource "google_service_account" "hetzner_runtime" {',
  '  account_id = "fa-hetzner-runtime"',
  '}',
  '',
  'resource "google_secret_manager_secret" "runtime" {',
  '  for_each = local.runtime_secret_names',
  '  secret_id = each.value',
  '}',
  '',
  'resource "google_secret_manager_secret" "provisioning" {',
  '  for_each = local.provisioning_secret_names',
  '  secret_id = each.value',
  '}',
  '',
  'resource "google_secret_manager_secret_iam_member" "provisioner_runtime_secret_accessor" {',
  '  for_each = google_secret_manager_secret.runtime',
  '  role    = "roles/secretmanager.secretAccessor"',
  '  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
  'resource "google_secret_manager_secret_iam_member" "provisioner_provisioning_secret_accessor" {',
  '  for_each = google_secret_manager_secret.provisioning',
  '  role    = "roles/secretmanager.secretAccessor"',
  '  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
  'resource "google_project_iam_member" "runtime_firestore_user" {',
  '  role    = "roles/datastore.user"',
  '  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"',
  '}',
  '',
  'resource "google_storage_bucket" "firestore_backups" {',
  '  name = var.firestore_backup_bucket',
  '}',
  '',
  'resource "google_storage_bucket_iam_member" "runtime_backup_writer" {',
  '  bucket = google_storage_bucket.firestore_backups.name',
  '  role   = "roles/storage.objectAdmin"',
  '  member = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneWithRuntimeDnsToken = [
  'locals {',
  '  secret_names = toset([',
  '    "FA_INTERNAL_AUTH_TOKEN",',
  '    "FA_CLOUDFLARE_DNS_API_TOKEN",',
  '  ])',
  '}',
  '',
  'resource "google_secret_manager_secret" "runtime" {',
  '  for_each = local.secret_names',
  '  secret_id = each.value',
  '}',
  '',
].join('\n');

const loadSecretsWithRuntimeDnsToken = [
  '#!/usr/bin/env bash',
  'FA_RUNTIME_SECRETS=(',
  '  FA_INTERNAL_AUTH_TOKEN',
  '  FA_CLOUDFLARE_DNS_API_TOKEN',
  ')',
  '',
].join('\n');

const loadSecretsWithDirectRuntimeDnsTokenWrite = [
  '#!/usr/bin/env bash',
  'write_env_line "${output_path}" FA_INTERNAL_AUTH_TOKEN "${token}"',
  'write_env_line "${output_path}" FA_CLOUDFLARE_DNS_API_TOKEN "${token}"',
  '',
].join('\n');

const terraformGcpDataPlaneWithRuntimeProjectSecretAccess = [
  terraformGcpDataPlaneWithProvisioningDnsToken,
  'resource "google_project_iam_member" "runtime_secret_accessor" {',
  '  project = var.project_id',
  '  role    = "roles/secretmanager.secretAccessor"',
  '  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneWithServiceAccountKey = [
  terraformGcpDataPlaneWithProvisioningDnsToken,
  'resource "google_service_account_key" "runtime_key" {',
  '  service_account_id = google_service_account.hetzner_runtime.name',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneWithExtraServiceAccount = [
  terraformGcpDataPlaneWithProvisioningDnsToken,
  'resource "google_service_account" "extra_runtime" {',
  '  account_id = "fa-extra-runtime"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneExtraSecretAccessor = [
  'resource "google_secret_manager_secret" "unapproved" {',
  '  secret_id = "FA_UNAPPROVED_SECRET"',
  '}',
  '',
  'resource "google_secret_manager_secret_iam_member" "provisioner_unapproved_secret_accessor" {',
  '  secret_id = google_secret_manager_secret.unapproved.secret_id',
  '  role      = "roles/secretmanager.secretAccessor"',
  '  member    = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneWrongBackupBucketGrant = [
  'resource "google_storage_bucket" "other_backups" {',
  '  name = "other-firestore-backups"',
  '}',
  '',
  'resource "google_storage_bucket_iam_member" "provisioner_other_backup_writer" {',
  '  bucket = google_storage_bucket.other_backups.name',
  '  role   = "roles/storage.objectAdmin"',
  '  member = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneBroadBackupBucketGrant =
  terraformGcpDataPlaneWithProvisioningDnsToken.replace(
    'role   = "roles/storage.objectAdmin"',
    'role   = "roles/storage.admin"'
  );

const terraformGcpDataPlaneMissingRuntimeServiceAccount =
  terraformGcpDataPlaneWithProvisioningDnsToken.replace(
    'resource "google_service_account" "hetzner_runtime" {\n  account_id = "fa-hetzner-runtime"\n}\n\n',
    ''
  );

const terraformGcpDataPlaneWithoutRuntimeFirestore =
  terraformGcpDataPlaneWithProvisioningDnsToken.replace(
    'resource "google_project_iam_member" "runtime_firestore_user" {\n  role    = "roles/datastore.user"\n  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"\n}\n\n',
    ''
  );

const terraformGcpDataPlaneWithForbiddenRuntimeRoles = [
  terraformGcpDataPlaneWithProvisioningDnsToken,
  'resource "google_project_iam_member" "runtime_owner" {',
  '  role    = "roles/owner"',
  '  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"',
  '}',
  '',
  'resource "google_project_iam_member" "runtime_key_admin" {',
  '  role    = "roles/iam.serviceAccountKeyAdmin"',
  '  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"',
  '}',
  '',
  'resource "google_project_iam_member" "runtime_project_admin" {',
  '  role    = "roles/resourcemanager.projectIamAdmin"',
  '  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneWithForbiddenProvisionerRoles = [
  terraformGcpDataPlaneWithProvisioningDnsToken,
  'resource "google_project_iam_member" "provisioner_firestore" {',
  '  role    = "roles/datastore.user"',
  '  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
  'resource "google_project_iam_member" "provisioner_editor" {',
  '  role    = "roles/editor"',
  '  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
  'resource "google_project_iam_member" "provisioner_sa_admin" {',
  '  role    = "roles/iam.serviceAccountAdmin"',
  '  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneWithProjectProvisionerSecretAccess = [
  terraformGcpDataPlaneWithProvisioningDnsToken,
  'resource "google_project_iam_member" "provisioner_project_secret_accessor" {',
  '  role    = "roles/secretmanager.secretAccessor"',
  '  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"',
  '}',
  '',
].join('\n');

const terraformGcpDataPlaneMissingProvisioningSecretAccess =
  terraformGcpDataPlaneWithProvisioningDnsToken.replace(
    'resource "google_secret_manager_secret_iam_member" "provisioner_provisioning_secret_accessor" {\n  for_each = google_secret_manager_secret.provisioning\n  role    = "roles/secretmanager.secretAccessor"\n  member  = "serviceAccount:${google_service_account.hetzner_provisioner.email}"\n}\n\n',
    ''
  );

const loadSecretsWithAmbientSecretManagerRead = [
  '#!/usr/bin/env bash',
  'gcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN',
  '',
].join('\n');

const loadSecretsWithReadBeforeCredentialExport = [
  '#!/usr/bin/env bash',
  'FA_HETZNER_PROVISIONER_KEY_FILE="${FA_HETZNER_PROVISIONER_KEY_FILE:-/etc/fa/keys/provisioner-sa-key.json}"',
  'gcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN',
  '[[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1',
  'export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"',
  '',
].join('\n');

const loadSecretsWithCredentialResetBeforeSecondRead = [
  '#!/usr/bin/env bash',
  'FA_HETZNER_PROVISIONER_KEY_FILE="${FA_HETZNER_PROVISIONER_KEY_FILE:-/etc/fa/keys/provisioner-sa-key.json}"',
  '[[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1',
  'export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"',
  'gcloud secrets versions access latest --secret=FA_INTERNAL_AUTH_TOKEN',
  'unset CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'gcloud secrets versions access latest --secret=FA_OPENAI_APP_API_KEY',
  '',
].join('\n');

const installNginxAndCertWithoutRequiredProvisionerKey = [
  '#!/usr/bin/env bash',
  'FA_HETZNER_PROVISIONER_KEY_FILE="${FA_HETZNER_PROVISIONER_KEY_FILE:-/etc/fa/keys/provisioner-sa-key.json}"',
  'if [[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]]; then',
  '  export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"',
  'fi',
  'gcloud secrets versions access latest --secret=FA_CLOUDFLARE_DNS_API_TOKEN',
  '',
].join('\n');

const docsWithCredentialMatrix = [
  '## Credential Matrix',
  '',
  '| Identity | Purpose | Key location | Permissions and ownership | Allowed roles | Forbidden roles and uses | Rotation |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| fa-admin | Bootstrap Terraform and retained GCP data-plane administration. | Local operator key, never production runtime. | Out-of-band install; local-only file with restrictive permissions. | Bootstrap IAM only. | No GitHub Actions, no production runtime, no Secret Manager runtime reads. | Rotate quarterly; revoke old keys after smoke tests. |',
  '| fa-hetzner-provisioner | Read explicit runtime and provisioning Secret Manager allowlists during deploy/provisioning. | /etc/fa/keys/provisioner-sa-key.json | root:deploy 0400 or 0440; installed out-of-band. | Secret Manager accessor on explicit runtime and provisioning secrets; bucket-level backup grant. | No Firestore runtime roles, owner/editor, service-account admin, service-account key admin, or broad project admin roles. | Rotate quarterly; revoke old keys after smoke tests. |',
  '| fa-hetzner-runtime | Firestore access for PM2 services. | /etc/fa/keys/runtime-sa-key.json mounted read-only to /run/secrets/fa-runtime-sa-key.json | root:deploy 0440; Docker mount is read-only; installed out-of-band. | roles/datastore.user. | No Secret Manager accessor, owner/editor, service-account admin, service-account key admin, or broad project admin roles. | Rotate quarterly; revoke old keys after smoke tests. |',
  '',
  'docs/operations/fa-mvp-runbook.md is the operator-facing checklist for production key installation, read-only runtime mounting, rotation, and old-key revocation.',
  '',
].join('\n');

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withStaticFixture<T>(files: Record<string, string | null>, run: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-verify-static-'));

  try {
    writeJson(root, 'package.json', {
      name: '@fa/root',
      private: true,
      scripts: {
        'verify:data-baseline': 'node scripts/verify-data-baseline.mjs',
        'services:delete': 'pnpm exec pm2 delete fa-chat-service',
        'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs',
        'verify:observability': 'node scripts/verify-observability.mjs',
      },
    });
    writeFile(root, 'AGENTS.md', '# AGENTS.md\n');
    writeFile(root, 'README.md', '# Fishing Assistant\n');
    writeFile(root, '.codex/skills/deploy/SKILL.md', '# Deploy\n');
    writeFile(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
    mkdirSync(path.join(root, 'migrations'), { recursive: true });
    writeJson(root, 'apps/web/package.json', {
      name: '@fa/web',
      private: true,
      scripts: {
        dev: 'node ../../scripts/run-web-vite.mjs --host 127.0.0.1 --port 3100',
        build: 'tsc --project tsconfig.json --noEmit && node ../../scripts/run-web-vite.mjs build',
        preview: 'node ../../scripts/run-web-vite.mjs preview --host 127.0.0.1 --port 3100',
      },
    });
    writeJson(root, 'apps/chat-service/package.json', {
      name: '@fa/chat-service',
      private: true,
      exports: { '.': './src/index.ts' },
    });
    writeJson(root, 'apps/knowledge-service/package.json', {
      name: '@fa/knowledge-service',
      private: true,
    });
    writeJson(root, 'apps/llm-usage-service/package.json', {
      name: '@fa/llm-usage-service',
      private: true,
      dependencies: {
        '@fa/common-http': 'workspace:*',
        '@fa/infra-firestore': 'workspace:*',
      },
    });
    writeJson(root, 'apps/user-service/package.json', {
      name: '@fa/user-service',
      private: true,
      dependencies: {
        '@fa/common-core': 'workspace:*',
        '@fa/common-http': 'workspace:*',
        '@fa/http-server': 'workspace:*',
        '@fa/infra-observability': 'workspace:*',
      },
    });
    writeJson(root, 'packages/common-core/package.json', {
      name: '@fa/common-core',
      private: true,
      exports: { '.': './src/index.ts' },
    });
    for (const packageName of [
      'common-http',
      'http-contracts',
      'http-server',
      'infra-firestore',
      'infra-observability',
      'internal-clients',
      'llm-contract',
      'llm-factory',
      'llm-pricing',
    ]) {
      writeJson(root, `packages/${packageName}/package.json`, {
        name: `@fa/${packageName}`,
        private: true,
        exports: { '.': './src/index.ts' },
      });
    }
    writeJson(root, 'firestore-collections.json', {
      $schema: 'https://fishing-assistant.online/schemas/firestore-collections.schema.json',
      description: 'Firestore registry.',
      collections: {
        _migrations: { owner: 'migration-runner', description: 'Migration ledger.' },
        fishing_conversations: {
          owner: 'chat-service',
          description: 'Chat conversation metadata.',
        },
        fishing_conversation_messages: {
          owner: 'chat-service',
          description: 'Chat conversation messages.',
        },
        fa_knowledge_nodes: {
          owner: 'knowledge-service',
          description: 'Knowledge nodes.',
        },
        fa_knowledge_pages: {
          owner: 'knowledge-service',
          description: 'Knowledge pages.',
        },
        fa_knowledge_chunks: {
          owner: 'knowledge-service',
          description: 'Knowledge chunks.',
        },
        llm_usage_events: {
          owner: 'llm-usage-service',
          description: 'Usage events.',
        },
        llm_usage_daily_aggregates: {
          owner: 'llm-usage-service',
          description: 'Daily usage aggregates.',
        },
        llm_pricing: {
          owner: 'llm-usage-service',
          description: 'Pricing catalog.',
        },
        fa_knowledge_access_refresh_jobs: {
          owner: 'knowledge-service',
          description: 'Knowledge access refresh jobs.',
        },
        fa_knowledge_access_audits: {
          owner: 'knowledge-service',
          description: 'Knowledge access audits.',
        },
        fa_users: {
          owner: 'user-service',
          description: 'User profiles.',
        },
        fa_user_identity_reservations: {
          owner: 'user-service',
          description: 'Identity reservations.',
        },
        fa_user_change_events: {
          owner: 'user-service',
          description: 'User change history.',
        },
      },
    });
    writeJson(root, 'firestore.indexes.json', {
      indexes: [
        {
          collectionGroup: 'fishing_conversations',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'fa_users',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'auth0Subject', order: 'ASCENDING' },
            { fieldPath: 'deletedAt', order: 'ASCENDING' },
          ],
        },
        {
          collectionGroup: 'fa_knowledge_chunks',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
            { fieldPath: 'embedding', vectorConfig: { dimension: 2048, flat: {} } },
          ],
        },
        {
          collectionGroup: 'fa_knowledge_chunks',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'accessSyncStatus', order: 'ASCENDING' },
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'pageId', order: 'ASCENDING' },
            { fieldPath: 'index', order: 'ASCENDING' },
          ],
        },
        {
          collectionGroup: 'fa_knowledge_access_refresh_jobs',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'status', order: 'ASCENDING' },
            { fieldPath: 'nextRunAt', order: 'ASCENDING' },
            { fieldPath: 'priority', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'llm_usage_daily_aggregates',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'owner.id', order: 'ASCENDING' },
            { fieldPath: 'bucket.day', order: 'ASCENDING' },
          ],
        },
      ],
      fieldOverrides: [],
    });
    writeFile(root, 'scripts/verify-data-baseline.mjs', 'export function ok() {}\n');
    writeFile(root, 'scripts/verify-knowledge-access.mjs', 'export function ok() {}\n');
    writeFile(
      root,
      'packages/http-contracts/src/routeSchemas.ts',
      [
        'const strictEmptyObjectSchema = { type: "object", additionalProperties: false } as const;',
        'export const knowledgeAdminAccessRefreshJobParamsSchema = {',
        '  type: "object",',
        '  additionalProperties: false,',
        '  required: ["jobId"],',
        '  properties: { jobId: { type: "string", minLength: 1 } },',
        '} as const;',
        'export const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'apps/knowledge-service/src/domain/usecases/syncDocument.ts',
      [
        'function buildPageChunks(input) {',
        '  const pageAccess = input.page.access.effective;',
        '  return [{',
        '    title: input.page.title,',
        '    path: [...input.page.pathTitles],',
        '    access: { gate: pageAccess.gate, requiredLevel: pageAccess.requiredLevel },',
        '    accessRevision: pageAccess.accessRevision,',
        "    accessSyncStatus: 'current',",
        '    source: {',
        '      type: input.page.source.type,',
        '      url: input.page.source.url,',
        '      label: input.page.source.label,',
        '    },',
        '  }];',
        '}',
        'export function syncDocument() {}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'apps/knowledge-service/src/domain/usecases/accessRefresh.ts',
      [
        'async function openAccessAuditsForPage(input) {',
        '  const chunkAccess = chunk.access;',
        '  const chunkSource = chunk.source;',
        '  const chunkSourceUrl = chunkSource?.url ?? null;',
        '  const actual = { accessPresent: chunkAccess !== undefined, sourcePresent: chunkSource !== undefined };',
        "  await upsertAccessAudit({ kind: 'missing_chunk_access', actual });",
        '  if (',
        '    chunkAccess.gate !== input.page.access.effective.gate ||',
        '    chunkAccess.requiredLevel !== input.page.access.effective.requiredLevel ||',
        '    chunk.accessRevision !== input.page.access.effective.accessRevision ||',
        '    chunkSourceUrl !== input.page.source.url',
        '  ) {',
        "    await upsertAccessAudit({ kind: 'chunk_page_access_mismatch', actual });",
        '  }',
        '}',
        'export function ok() {}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts',
      [
        'function publicEvidenceId(input) {',
        '  return `knowledge-page:${input.page.title}`;',
        '}',
        'function evidenceFromChunk(input) {',
        '  return {',
        '    id: publicEvidenceId(input),',
        "    sourceType: 'knowledge_page',",
        '    metadata: {',
        '      headingPath: [...input.chunk.headingPath],',
        '      path: [...input.chunk.path],',
        '    },',
        '  };',
        '}',
        'function overfetchLimit(limit) {',
        '  return Math.min(Math.max(limit * 8, 40), 120);',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'apps/chat-service/src/domain/rag/rag.ts',
      [
        'function publicEvidenceMetadata(metadata) {',
        '  return { headingPath: metadata.headingPath };',
        '}',
        'function retrievalTrace(input) {',
        '  return {',
        '    evidence: input.evidence.map((item) => ({',
        '      metadata: publicEvidenceMetadata(item.metadata),',
        '    })),',
        '  };',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'apps/chat-service/src/infra/http/knowledgeServiceRagSource.ts',
      [
        'function isRagEvidenceSourceType(value) {',
        "  return value === 'knowledge_page';",
        '}',
        'function isRagEvidenceMetadata(value) {',
        "  const forbiddenKnowledgeMetadataKeys = ['documentId', 'pageId', 'chunkId'];",
        '  return forbiddenKnowledgeMetadataKeys.every((key) => value[key] === undefined);',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'apps/llm-usage-service/src/routes/internalUsageRoutes.ts',
      "import { validateInternalAuth } from '@fa/common-http';\nexport function register(app: { post(path: string, handler: unknown): void }) { validateInternalAuth({}, {}); app.post('/internal/usage-events', () => undefined); }\n"
    );
    writeJson(root, 'apps/web/service-manifest.json', {
      services: [
        {
          name: 'chat-service',
          envSuffix: 'CHAT_SERVICE',
          apiPath: '/api/chat',
          proxyTarget: 'http://localhost:3201',
          serviceUrl: 'http://localhost:3201',
        },
      ],
    });
    writeFile(
      root,
      'apps/web/src/config.generated.ts',
      "// GENERATED FILE - DO NOT EDIT\n\nexport const WEB_SERVICE_URLS = {\n  CHAT_SERVICE: '/api/chat',\n} as const;\n\nexport const WEB_SERVICE_ENV_NAMES = {\n  CHAT_SERVICE: 'FA_CHAT_SERVICE_URL',\n} as const;\n"
    );
    writeFile(
      root,
      'ecosystem.generated.cjs',
      "// GENERATED FILE - DO NOT EDIT\n\nconst COMMON_SERVICE_URLS_GENERATED = {\n  FA_CHAT_SERVICE_URL: '/api/chat',\n};\n\nmodule.exports = { COMMON_SERVICE_URLS_GENERATED };\n"
    );
    writeJson(root, 'terraform/hetzner-prod/service-urls.auto.tfvars.json', {
      generated_file_notice: 'GENERATED FILE - DO NOT EDIT',
      service_urls: { FA_CHAT_SERVICE_URL: '/api/chat' },
    });
    writeFile(
      root,
      'apps/web/vite.config.ts',
      "import { defineConfig } from 'vite';\nconst WEB_SERVICE_URLS = {};\nconst proxy = { '/api/chat': { bypass: (request: { url?: string }) => request.url?.includes('/internal') ? false : undefined, rewrite: (path: string) => path.replace(/^\\/api\\/chat(?=\\/|$)/, '') || '/' } };\nexport default defineConfig({ envPrefix: 'FA_', envDir: false, server: { allowedHosts: ['dev.fishing-assistant.online'], proxy } });\nvoid WEB_SERVICE_URLS;\n"
    );
    writeFile(
      root,
      'scripts/run-web-vite.mjs',
      "const WEB_SAFE_FA_ENV_NAMES = new Set(['FA_ENVIRONMENT']);\nexport function createSanitizedWebEnv(sourceEnv = process.env) { const sanitized = {}; for (const [key, value] of Object.entries(sourceEnv)) { if (key.startsWith('FA_') && !WEB_SAFE_FA_ENV_NAMES.has(key)) continue; sanitized[key] = value; } return sanitized; }\n"
    );
    writeFile(
      root,
      'ecosystem.config.cjs',
      "module.exports = { apps: [{ name: 'fa-web', script: './scripts/run-web-vite.mjs', args: ['preview', '--host', '127.0.0.1', '--port', '3100'], filter_env: ['FA_'] }] };\n"
    );
    writeFile(
      root,
      'apps/web/src/services/apiClient.ts',
      'export function ok() { return fetch; }\n'
    );
    writeFile(root, 'scripts/bootstrap/bootstrap-gcp-data-plane.sh', '#!/usr/bin/env bash\n');
    writeFile(
      root,
      'scripts/deploy/deploy-dev.sh',
      [
        '#!/usr/bin/env bash',
        'FA_PM2_HOME="${FA_PM2_HOME:-${HOME}/.pm2-fa}"',
        'wait_for_edge_health() {',
        '  local curl_args=(--fail --silent --show-error --max-time 5)',
        '}',
        'ensure_dev_env_files() {',
        '  [[ -f .envrc ]] || exit 1',
        '  [[ -f .env.dev.local ]] || exit 1',
        '}',
        'ensure_dev_env_files',
        'direnv exec . pnpm install --frozen-lockfile',
        'FA_DEV_ORIGIN="${FA_DEV_ORIGIN}" node scripts/smoke/e2e-dev.mjs',
        'node scripts/smoke/auth0-authorize-preflight.mjs',
        'PM2_HOME="${FA_PM2_HOME}" pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env',
        'wait_for_edge_health "${FA_DEV_ORIGIN}/api/users/health"',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/dev-host/fa-pm2.service',
      '[Service]\nEnvironment=FA_PM2_HOME=%h/.pm2-fa\nEnvironment=PM2_HOME=%h/.pm2-fa\nWorkingDirectory=%h/deploy/fishing-assistant\nExecReload=/usr/bin/direnv exec %h/deploy/fishing-assistant pnpm exec pm2 reload fa-web\n'
    );
    writeFile(root, 'scripts/dev-host/webhook-handler.mjs', 'export function ok() {}\n');
    writeFile(
      root,
      'scripts/dev-host/caddy/fishing-assistant.Caddyfile',
      [
        'handle / {',
        '    reverse_proxy localhost:3100',
        '}',
        'handle_path /api/users/* {',
        '    reverse_proxy localhost:3204',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/dev-host/webhook-handler.service',
      [
        '[Service]',
        'Environment=FA_NODE_BIN=/usr/bin/node',
        'Environment=FA_DEV_REPO_PATH=%h/deploy/fishing-assistant',
        'Environment=FA_DEV_DEPLOY_SCRIPT=%h/deploy/fishing-assistant/scripts/deploy/deploy-dev.sh',
        'Environment=FA_PM2_HOME=%h/.pm2-fa',
        'Environment=PM2_HOME=%h/.pm2-fa',
        'ExecStart=/usr/bin/env ${FA_NODE_BIN} %h/tools/fa-webhook-handler/webhook-handler.mjs',
        '',
      ].join('\n')
    );
    writeFile(root, 'scripts/hetzner/provision.sh', provisionWithNarrowSudoWrappers);
    writeFile(
      root,
      'scripts/hetzner/load-secrets.sh',
      '#!/usr/bin/env bash\nFA_PROD_OPENROUTER_APP_API_KEY=FA_OPENROUTER_APP_API_KEY\nFA_PROD_MINIMAX_APP_API_KEY=FA_MINIMAX_APP_API_KEY\n'
    );
    writeFile(root, 'scripts/hetzner/load-observability-env.sh', '#!/usr/bin/env bash\n');
    writeFile(
      root,
      'scripts/ci.mjs',
      [
        'const phases = [',
        "  ['Static verification', 'pnpm', ['run', 'verify:static']],",
        "  ['Runtime data baseline verifier tests', 'pnpm', ['exec', 'vitest', 'run', 'scripts/__tests__/verify-data-baseline.test.ts']],",
        "  ['Knowledge access verification', 'pnpm', ['run', 'verify:knowledge-access']],",
        "  ['Observability verification', 'pnpm', ['run', 'verify:observability']],",
        '];',
        'void phases;',
        '',
      ].join('\n')
    );
    writeFile(root, 'scripts/hetzner/install-nginx-and-cert.sh', '#!/usr/bin/env bash\n');
    writeFile(root, 'scripts/hetzner/deploy-nginx.sh', '#!/usr/bin/env bash\n');
    writeFile(root, 'scripts/hetzner/deploy-web.sh', '#!/usr/bin/env bash\n');
    writeFile(root, 'scripts/hetzner/build-services-image.sh', '#!/usr/bin/env bash\n');
    writeFile(
      root,
      'scripts/hetzner/reload-services-container.sh',
      'docker run --name fa-services -v "/etc/fa/keys/runtime-sa-key.json:/run/secrets/fa-runtime-sa-key.json:ro" -p 127.0.0.1:3201:3201 fa-services:abc123\n'
    );
    writeFile(
      root,
      'scripts/hetzner/github-actions-deploy.sh',
      githubActionsDeployWithPinnedHostTrust
    );
    writeFile(root, 'scripts/smoke/auth0-authorize-preflight.mjs', '#!/usr/bin/env node\n');
    writeFile(
      root,
      'scripts/hetzner/nginx/fishing-assistant.conf',
      'server_name fishing-assistant.online;\n'
    );
    writeFile(
      root,
      'scripts/hetzner/nginx/fishing-assistant.origin-http.conf',
      'server_name fishing-assistant.online;\n'
    );
    writeFile(
      root,
      'scripts/observability/fa-alloy.service',
      [
        '[Unit]',
        'Description=Fishing Assistant Grafana Alloy collector',
        'After=network-online.target',
        'Wants=network-online.target',
        '',
        '[Service]',
        'Type=simple',
        'EnvironmentFile=-/etc/fa/observability.env',
        'ExecStart=/usr/bin/alloy run --server.http.listen-addr=127.0.0.1:12346 /etc/fa/alloy/fa.alloy',
        'Restart=always',
        'RestartSec=5',
        '',
        '[Install]',
        'WantedBy=multi-user.target',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/observability/install-alloy.sh',
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'ENVIRONMENT=dev',
        'HOST=dev-host',
        'install -d -o root -g root -m 755 /etc/fa/alloy',
        'node scripts/observability/render-alloy-config.mjs --environment "${ENVIRONMENT}" --host "${HOST}" --output /etc/fa/alloy/fa.alloy',
        'install -m 0644 scripts/observability/fa-alloy.service /etc/systemd/system/fa-alloy.service',
        'usermod -aG docker alloy',
        'systemctl daemon-reload',
        'systemctl enable --now fa-alloy',
        'if [[ "${1:-}" == "--with-alert-router" ]]; then',
        '  [[ -f scripts/observability/alert-router.mjs ]] || exit 1',
        '  install -m 0644 scripts/dev-host/fa-alert-router.service /etc/systemd/system/fa-alert-router.service',
        '  systemctl enable --now fa-alert-router',
        'fi',
        'printf "Verify with: systemctl status fa-alloy --no-pager\\n"',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile',
      [
        'handle /healthz {',
        '    respond "ok" 200',
        '}',
        '',
        'handle /alerts/grafana {',
        '    reverse_proxy 127.0.0.1:9002',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/dev-host/fa-alert-router.service',
      [
        '[Service]',
        'Environment=FA_ALERT_ROUTER_BIND_HOST=127.0.0.1',
        'Environment=PORT=9002',
        'EnvironmentFile=-/etc/fa/observability.env',
        'User=fa-deploy',
        'ExecStart=/usr/bin/env bash -lc \'cd "${FA_DEV_DEPLOY_ROOT:?}" && exec /usr/bin/node scripts/observability/alert-router.mjs\'',
        'Restart=always',
        'RestartSec=5',
        'StandardOutput=journal',
        'StandardError=journal',
        'SyslogIdentifier=fa-alert-router',
        'NoNewPrivileges=true',
        'PrivateTmp=true',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/hetzner/fa-alert-router.service',
      [
        '[Service]',
        'Environment=FA_ALERT_ROUTER_BIND_HOST=127.0.0.1',
        'Environment=PORT=9002',
        'EnvironmentFile=-/etc/fa/observability.env',
        'User=deploy',
        'Group=deploy',
        'WorkingDirectory=/opt/fishing-assistant/current',
        'ExecStart=/usr/bin/node /opt/fishing-assistant/current/scripts/observability/alert-router.mjs',
        'Restart=always',
        'RestartSec=5',
        'StandardOutput=journal',
        'StandardError=journal',
        'SyslogIdentifier=fa-alert-router',
        'NoNewPrivileges=true',
        'PrivateTmp=true',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'scripts/hetzner/install-observability.sh',
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'ENVIRONMENT=prod',
        'HOST=hetzner-prod',
        'SHA="${DEPLOY_SHA:-unknown}"',
        'install -d -o root -g root -m 755 /etc/fa/alloy',
        'node scripts/observability/render-alloy-config.mjs --environment "${ENVIRONMENT}" --host "${HOST}" --sha "${SHA}" --output /etc/fa/alloy/fa.alloy',
        'install -m 0644 scripts/observability/fa-alloy.service /etc/systemd/system/fa-alloy.service',
        'usermod -aG docker alloy',
        'systemctl daemon-reload',
        'systemctl enable --now fa-alloy',
        'if [[ "${1:-}" == "--with-alert-router" ]]; then',
        '  [[ -f scripts/observability/alert-router.mjs ]] || exit 1',
        '  install -m 0644 scripts/hetzner/fa-alert-router.service /etc/systemd/system/fa-alert-router.service',
        '  systemctl enable --now fa-alert-router',
        'fi',
        'printf "Verify with: journalctl -u fa-alloy --no-pager\\n"',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'terraform/hetzner-prod/cloud-init.yaml.tftpl',
      [
        '#cloud-config',
        'users:',
        '  - name: deploy',
        '    ssh_authorized_keys:',
        '      - ${deploy_ssh_public_key}',
        'runcmd:',
        '  - install -d -o root -g deploy -m 750 /etc/fa/keys',
        '  - install -d -o root -g deploy -m 750 /etc/fa/alloy',
        '  - touch /etc/fa/observability.env',
        '  - chown root:deploy /etc/fa/observability.env',
        '  - chmod 0640 /etc/fa/observability.env',
        '',
      ].join('\n')
    );
    writeFile(root, 'scripts/smoke/e2e-dev.mjs', '#!/usr/bin/env node\n');
    writeFile(root, 'scripts/ops/export-firestore-backup.sh', '#!/usr/bin/env bash\n');
    writeFile(root, 'docker/prod/Dockerfile', 'CMD ["pm2-runtime", "ecosystem.config.prod.cjs"]\n');
    writeFile(
      root,
      'terraform/gcp-data-plane/main.tf',
      terraformGcpDataPlaneWithProvisioningDnsToken
    );
    writeFile(root, 'terraform/gcp-data-plane/versions.tf', 'terraform {}\n');
    writeFile(
      root,
      'terraform/hetzner-prod/hetzner.tf',
      'resource "hcloud_server" "prod" { user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", { deploy_ssh_public_key = var.deploy_ssh_public_key }) }\n'
    );
    writeFile(root, 'terraform/hetzner-prod/versions.tf', 'terraform {}\n');
    writeFile(
      root,
      'terraform/hetzner-prod/cloud-init.yaml.tftpl',
      cloudInitWithNarrowSudoWrappers
    );
    writeFile(root, '.github/workflows/deploy.yml', deployWorkflowWithProdMainAncestryCheck);
    writeFile(
      root,
      'docs/operations/fa-mvp-runbook.md',
      [
        '# FA MVP Runbook',
        'Copy `scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile` into the host-level FA Caddy site because canonical DEV Caddy config lives outside this repo.',
        '',
        docsWithCredentialMatrix,
        '',
      ].join('\n')
    );
    writeFile(root, 'docs/operations/fa-observability-runbook.md', '# FA Observability Runbook\n');

    for (const [relativePath, contents] of Object.entries(files)) {
      if (contents === null) {
        rmSync(path.join(root, relativePath), { force: true });
      } else {
        writeFile(root, relativePath, contents);
      }
    }

    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('static verifier', () => {
  it('accepts a minimal valid Phase 1 repository shape', () => {
    withStaticFixture({}, (root) => {
      expect(validateStaticRepository(root)).toEqual([]);
    });
  });

  it('enforces Task 5.4 knowledge access verifier wiring and strict route schemas', () => {
    withStaticFixture(
      {
        'package.json': JSON.stringify({
          name: '@fa/root',
          private: true,
          scripts: {
            'services:delete': 'pnpm exec pm2 delete fa-chat-service',
            'verify:observability': 'node scripts/verify-observability.mjs',
          },
        }),
        'scripts/verify-knowledge-access.mjs': null,
        'firestore-collections.json': JSON.stringify({
          $schema: 'https://fishing-assistant.online/schemas/firestore-collections.schema.json',
          description: 'Firestore registry.',
          collections: {
            _migrations: { owner: 'migration-runner', description: 'Migration ledger.' },
            fishing_conversations: {
              owner: 'chat-service',
              description: 'Chat conversation metadata.',
            },
            fishing_knowledge_documents: {
              owner: 'knowledge-service',
              description: 'Knowledge documents.',
            },
            llm_usage_events: {
              owner: 'llm-usage-service',
              description: 'Usage events.',
            },
            llm_usage_daily_aggregates: {
              owner: 'llm-usage-service',
              description: 'Daily usage aggregates.',
            },
            llm_pricing: {
              owner: 'llm-usage-service',
              description: 'Pricing catalog.',
            },
            fa_knowledge_access_refresh_jobs: {
              owner: 'knowledge-service',
              description: 'Knowledge access refresh jobs.',
            },
          },
        }),
        'packages/http-contracts/src/routeSchemas.ts':
          'export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false, properties: { jobId: {}, actorAdminUserId: {} } };\n',
        'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts':
          'export const citationFallback = true;\n',
        'apps/web/src/workspace/WorkspaceApp.tsx':
          "export function renderCitation() { return '#/knowledge/documents/doc-1'; }\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'package.json scripts must define verify:knowledge-access',
            'Missing scripts/verify-knowledge-access.mjs',
            'firestore-collections.json must register fa_knowledge_access_audits with owner knowledge-service',
            'packages/http-contracts/src/routeSchemas.ts access-refresh retry body schema must be a strict empty object',
            'packages/http-contracts/src/routeSchemas.ts access-refresh route schemas must not accept actorAdminUserId',
            'deprecated citation fallback must remain absent',
          ])
        );
      }
    );
  });

  it('rejects deprecated document hash route citation fallbacks in the web renderer', () => {
    withStaticFixture(
      {
        'apps/web/src/workspace/WorkspaceApp.tsx':
          "export function WorkspaceApp() { return <a href={`#/knowledge/documents/${'doc-1'}`}>Deprecated citation</a>; }\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'deprecated citation fallback must remain absent'
        );
      }
    );
  });

  it('rejects lazy loading the core workspace shell from the app shell', () => {
    withStaticFixture(
      {
        'apps/web/src/App.tsx':
          "import { lazy } from 'react';\nconst WorkspaceApp = lazy(() => import('./workspace/WorkspaceApp.js'));\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'apps/web/src/App.tsx must statically import WorkspaceApp so protected routes do not blank after deploy-pruned lazy chunks'
        );
      }
    );
  });

  it('rejects public RAG evidence contracts that expose internal Knowledge Base identifiers', () => {
    withStaticFixture(
      {
        'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts': [
          "export const sourceType = 'knowledge_document';",
          'function evidenceFromChunk(input) {',
          '  return {',
          '    id: `knowledge:${input.chunk.id}`,',
          "    sourceType: 'knowledge_document',",
          '    metadata: {',
          '      documentId: input.page.id,',
          '      headingPath: [...input.chunk.headingPath],',
          '      chunkId: input.chunk.id,',
          '    },',
          '  };',
          '}',
          'function overfetchLimit(limit) {',
          '  return Math.min(96, Math.max(limit, limit * 4));',
          '}',
          '',
        ].join('\n'),
        'apps/chat-service/src/domain/rag/rag.ts': [
          'function retrievalTrace(input) {',
          '  return {',
          '    evidence: input.evidence.map((item) => ({',
          '      metadata: { ...item.metadata },',
          '    })),',
          '  };',
          '}',
          '',
        ].join('\n'),
        'apps/chat-service/src/infra/http/knowledgeServiceRagSource.ts': [
          'function isRagEvidenceSourceType(value) {',
          "  return value === 'knowledge_document';",
          '}',
          'function isRagEvidenceMetadata(value) {',
          '  return optionalString(value.documentId) && optionalString(value.chunkId);',
          '}',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts public RAG evidence must use knowledge_page, not removed knowledge_document',
            'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts public RAG evidence ids must use knowledge-page: safe ids instead of raw knowledge: chunk ids',
            'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts public RAG evidence metadata must not expose documentId or chunkId',
            'apps/knowledge-service/src/domain/usecases/retrieveKnowledge.ts retrieval must overfetch at least min(max(topK * 8, 40), 120) before authorization filtering',
            'apps/chat-service/src/domain/rag/rag.ts public retrieval traces must sanitize evidence metadata instead of copying item.metadata',
            'apps/chat-service/src/infra/http/knowledgeServiceRagSource.ts Knowledge Service RAG parser must accept knowledge_page evidence',
            'apps/chat-service/src/infra/http/knowledgeServiceRagSource.ts Knowledge Service RAG parser must reject internal documentId/pageId/chunkId metadata',
          ])
        );
      }
    );
  });

  it('reports missing required workspace paths', () => {
    const expectedErrors = [
      'Missing required workspace path: apps/knowledge-service/package.json',
      'Missing required workspace path: apps/user-service/package.json',
      'Missing required workspace path: packages/internal-clients/package.json',
      'Missing required workspace path: README.md',
      'Missing required workspace path: .codex/skills/deploy/SKILL.md',
    ];

    withStaticFixture(
      {
        'apps/knowledge-service/package.json': null,
        'apps/user-service/package.json': null,
        'packages/internal-clients/package.json': null,
        'README.md': null,
        '.codex/skills/deploy/SKILL.md': null,
      },
      (root) => {
        const workspaceErrors = validateStaticRepository(root)
          .filter((error) => error.startsWith('Missing required workspace path: '))
          .toSorted();

        expect(workspaceErrors).toEqual(expectedErrors.toSorted());
      }
    );
  });

  it('rejects required workspace paths with the wrong filesystem type', () => {
    withStaticFixture({}, (root) => {
      rmSync(path.join(root, 'migrations'), { recursive: true, force: true });
      writeFileSync(path.join(root, 'migrations'), 'not a directory\n');

      expect(validateStaticRepository(root)).toContain(
        'Required workspace path must be a directory: migrations'
      );
    });
  });

  it('requires workspace package names to use the @fa scope', () => {
    withStaticFixture(
      {
        'packages/common-core/package.json': JSON.stringify({
          name: '@other/common-core',
          private: true,
          exports: { '.': './src/index.ts' },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'packages/common-core/package.json package name must start with @fa/'
        );
      }
    );
  });

  it('rejects app-to-app imports and raw web fetch calls outside the API client', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/index.ts': "import '@fa/knowledge-service';\n",
        'apps/web/src/App.tsx': 'export const load = () => fetch("/api/chat");\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/chat-service/src/index.ts must not import app package @fa/knowledge-service',
            'Raw fetch is only allowed in apps/web/src/services/apiClient.ts: apps/web/src/App.tsx',
          ])
        );
      }
    );
  });

  it('rejects llm-factory imports from knowledge-service domain files', () => {
    withStaticFixture(
      {
        'apps/knowledge-service/src/domain/usecases/syncDocument.ts':
          "import { DEFAULT_EMBEDDING_MODEL } from '@fa/llm-factory';\nvoid DEFAULT_EMBEDDING_MODEL;\n",
        'apps/knowledge-service/src/config.ts':
          "import { resolveLlmProviderConfig } from '@fa/llm-factory';\nvoid resolveLlmProviderConfig;\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'apps/knowledge-service/src/domain/usecases/syncDocument.ts must not import @fa/llm-factory from knowledge-service domain code'
        );
      }
    );
  });

  it('requires Firestore collection entries to use keyed registry metadata', () => {
    withStaticFixture(
      {
        'firestore-collections.json': JSON.stringify({
          collections: {
            fishing_conversations: { owner: 'chat-service' },
            fishing_knowledge_chunks: { description: 'Chunks.' },
          },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'firestore-collections.json must declare a $schema string',
            'firestore-collections.json must declare a description string',
            'firestore-collections.json collections.fishing_conversations.description must be a non-empty string',
            'firestore-collections.json collections.fishing_knowledge_chunks.owner must be a non-empty string',
            'firestore-collections.json must register _migrations',
          ])
        );
      }
    );
  });

  it('requires llm-usage-service ownership of every usage collection', () => {
    withStaticFixture(
      {
        'firestore-collections.json': JSON.stringify({
          $schema: 'https://fishing-assistant.online/schemas/firestore-collections.schema.json',
          description: 'Firestore registry.',
          collections: {
            _migrations: { owner: 'migration-runner', description: 'Migration ledger.' },
            llm_usage_events: { owner: 'chat-service', description: 'Usage events.' },
            llm_usage_daily_aggregates: {
              owner: 'llm-usage-service',
              description: 'Daily aggregates.',
            },
          },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'firestore-collections.json must register llm_usage_events with owner llm-usage-service',
            'firestore-collections.json must register llm_pricing with owner llm-usage-service',
          ])
        );
      }
    );
  });

  it('enforces runtime data baseline cleanup artifacts and verifier wiring', () => {
    withStaticFixture(
      {
        'package.json': JSON.stringify({
          name: '@fa/root',
          private: true,
          scripts: {
            'services:delete': 'pnpm exec pm2 delete fa-chat-service',
            'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs',
            'verify:observability': 'node scripts/verify-observability.mjs',
          },
        }),
        'scripts/verify-data-baseline.mjs': null,
        'firestore-collections.json': JSON.stringify({
          $schema: 'https://fishing-assistant.online/schemas/firestore-collections.schema.json',
          description: 'Firestore registry.',
          collections: {
            _migrations: { owner: 'migration-runner', description: 'Migration ledger.' },
            fishing_knowledge_documents: {
              owner: 'knowledge-service',
              description: 'Removed knowledge documents.',
            },
            fishing_knowledge_chunks: {
              owner: 'knowledge-service',
              description: 'Removed knowledge chunks.',
            },
            llm_usage_events: { owner: 'llm-usage-service', description: 'Usage events.' },
            llm_usage_daily_aggregates: {
              owner: 'llm-usage-service',
              description: 'Daily usage aggregates.',
            },
            llm_pricing: { owner: 'llm-usage-service', description: 'Pricing catalog.' },
            fa_knowledge_access_refresh_jobs: {
              owner: 'knowledge-service',
              description: 'Knowledge access refresh jobs.',
            },
            fa_knowledge_access_audits: {
              owner: 'knowledge-service',
              description: 'Knowledge access audits.',
            },
          },
        }),
        'firestore.indexes.json': JSON.stringify({
          indexes: [
            {
              collectionGroup: 'fishing_knowledge_documents',
              queryScope: 'COLLECTION',
              fields: [
                { fieldPath: 'workspaceId', order: 'ASCENDING' },
                { fieldPath: 'status', order: 'ASCENDING' },
                { fieldPath: 'updatedAt', order: 'DESCENDING' },
              ],
            },
          ],
          fieldOverrides: [],
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'package.json scripts must define verify:data-baseline',
            'Missing scripts/verify-data-baseline.mjs',
            'firestore-collections.json must not register fishing_knowledge_documents after runtime data baseline cleanup',
            'firestore-collections.json must not register fishing_knowledge_chunks after runtime data baseline cleanup',
            'firestore.indexes.json must not contain removed Knowledge Base indexes for fishing_knowledge_documents or fishing_knowledge_chunks',
            'firestore.indexes.json must include runtime data baseline indexes for user auth, knowledge access refresh, knowledge vector retrieval, and usage aggregation',
          ])
        );
      }
    );
  });

  it('rejects stale generated wiring, non-FA env references, and missing Vite proxy stripping', () => {
    withStaticFixture(
      {
        'apps/web/src/config.generated.ts': 'stale\n',
        'scripts/bad.mjs': `process.env.${foreignProductTokenEnv};\n`,
        'apps/web/vite.config.ts':
          "import { defineConfig } from 'vite';\nconst WEB_SERVICE_URLS = {};\nexport default defineConfig({ envPrefix: 'FA_', server: { proxy: { '/api/chat': 'http://localhost:3201' } } });\nvoid WEB_SERVICE_URLS;\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'Generated service wiring is stale: apps/web/src/config.generated.ts',
            `Forbidden non-FA product env reference in scripts/bad.mjs: ${foreignProductTokenEnv}`,
            'apps/web/vite.config.ts must strip API prefixes in the Vite proxy rewrite',
            'apps/web/vite.config.ts must return 404 for public /api/*/internal/* routes before proxying',
            'apps/web/vite.config.ts must allow the DEV public hostname',
          ])
        );
      }
    );
  });

  it('rejects web Vite entrypoints that can inherit backend-only FA env', () => {
    withStaticFixture(
      {
        'apps/web/package.json': JSON.stringify({
          name: '@fa/web',
          private: true,
          scripts: {
            dev: 'vite --host 127.0.0.1 --port 3100',
            build: 'tsc --project tsconfig.json --noEmit && vite build',
            preview: 'vite preview --host 127.0.0.1 --port 3100',
          },
        }),
        'apps/web/vite.config.ts':
          "import { defineConfig } from 'vite';\nexport default defineConfig({ envPrefix: 'FA_', server: { allowedHosts: ['dev.fishing-assistant.online'], proxy: { '/api/chat': { rewrite: (path: string) => path.replace(/^\\/api\\/chat(?=\\/|$)/, '') || '/' } } } });\n",
        'ecosystem.config.cjs':
          "module.exports = { apps: [{ name: 'fa-web', script: './node_modules/vite/bin/vite.js', args: ['--host', '127.0.0.1'] }] };\n",
        'scripts/run-web-vite.mjs': null,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/web/package.json scripts must run Vite through scripts/run-web-vite.mjs',
            'apps/web/vite.config.ts must set envDir: false so Vite cannot load backend-only FA values from web .env files',
            'ecosystem.config.cjs fa-web must run through scripts/run-web-vite.mjs',
            'Missing scripts/run-web-vite.mjs',
          ])
        );
      }
    );
  });

  it('rejects current-schema chunk generation that omits page path, access, revision, or source metadata', () => {
    withStaticFixture(
      {
        'apps/knowledge-service/src/domain/usecases/syncDocument.ts': [
          'export async function syncDocument() {',
          '  const chunk = {',
          '    title: page.title,',
          '    headingPath: draft.headingPath,',
          "    access: { gate: 'approved', requiredLevel: null },",
          '  };',
          '  return chunk;',
          '}',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/knowledge-service/src/domain/usecases/syncDocument.ts current-schema chunk generation must copy page pathTitles into active chunks',
            'apps/knowledge-service/src/domain/usecases/syncDocument.ts current-schema chunk generation must copy page effective access gate and requiredLevel into active chunks',
            'apps/knowledge-service/src/domain/usecases/syncDocument.ts current-schema chunk generation must copy page access revision and current access sync status into active chunks',
            'apps/knowledge-service/src/domain/usecases/syncDocument.ts current-schema chunk generation must copy page source URL metadata into active chunks when available',
          ])
        );
      }
    );
  });

  it('rejects knowledge access monitoring that does not flag missing or mismatched chunk/page access metadata', () => {
    withStaticFixture(
      {
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': [
          'export async function auditKnowledgeAccessPage() {',
          "  await upsertAccessAudit({ kind: 'missing_chunk_access' });",
          '  if (chunk.accessRevision !== page.access.effective.accessRevision) {',
          "    await upsertAccessAudit({ kind: 'chunk_page_access_mismatch' });",
          '  }',
          '}',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/knowledge-service/src/domain/usecases/accessRefresh.ts chunk/page access monitoring must flag missing chunk access metadata with accessPresent details',
            'apps/knowledge-service/src/domain/usecases/accessRefresh.ts chunk/page access monitoring must compare chunk gate, requiredLevel, revision, and source URL against the page',
          ])
        );
      }
    );
  });

  it('scopes knowledge access monitoring checks to openAccessAuditsForPage itself', () => {
    withStaticFixture(
      {
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': [
          'const helper = () => {',
          '  const actual = { accessPresent: chunkAccess !== undefined };',
          "  void { kind: 'missing_chunk_access' };",
          '  if (',
          '    chunkAccess.gate !== input.page.access.effective.gate ||',
          '    chunkAccess.requiredLevel !== input.page.access.effective.requiredLevel ||',
          '    chunk.accessRevision !== input.page.access.effective.accessRevision ||',
          '    chunk.source.url !== input.page.source.url',
          '  ) {',
          "    void { kind: 'chunk_page_access_mismatch' };",
          '  }',
          '};',
          'async function openAccessAuditsForPage(input) {',
          '  return input;',
          '}',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/knowledge-service/src/domain/usecases/accessRefresh.ts chunk/page access monitoring must flag missing chunk access metadata with accessPresent details',
            'apps/knowledge-service/src/domain/usecases/accessRefresh.ts chunk/page access monitoring must compare chunk gate, requiredLevel, revision, and source URL against the page',
          ])
        );
      }
    );
  });

  it('rejects PM2 scripts that target every process on the host', () => {
    withStaticFixture(
      {
        'package.json': JSON.stringify({
          name: '@fa/root',
          private: true,
          scripts: {
            'services:delete': 'pnpm exec pm2 delete all',
          },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'package.json script services:delete must target FA PM2 processes instead of all'
        );
      }
    );
  });

  it('rejects CI pipelines that mutate generated service wiring or skip observability verification', () => {
    withStaticFixture(
      {
        'package.json': JSON.stringify({
          name: '@fa/root',
          private: true,
          scripts: {
            'services:delete': 'pnpm exec pm2 delete fa-chat-service',
          },
        }),
        'scripts/ci.mjs':
          "const phases = [['Generate service wiring', 'pnpm', ['run', 'generate:service-wiring']]];\nvoid phases;\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'package.json scripts must define verify:observability',
            'scripts/ci.mjs must verify generated service wiring without running generate:service-wiring',
            'scripts/ci.mjs must run CI-safe runtime data baseline verifier tests instead of live Firestore verification',
            'scripts/ci.mjs must run verify:knowledge-access after verify:static',
            'scripts/ci.mjs must run verify:observability after verify:static',
          ])
        );
      }
    );
  });

  it('rejects generic verify scripts that omit CI-safe runtime data baseline verifier tests', () => {
    withStaticFixture(
      {
        'package.json': JSON.stringify({
          name: '@fa/root',
          private: true,
          scripts: {
            'verify:data-baseline': 'node scripts/verify-data-baseline.mjs',
            verify: 'pnpm run verify:service-wiring && pnpm run verify:env',
            'services:delete': 'pnpm exec pm2 delete fa-chat-service',
            'verify:observability': 'node scripts/verify-observability.mjs',
          },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'package.json verify must run CI-safe runtime data baseline verifier tests instead of live Firestore verification'
        );
      }
    );
  });

  it('rejects common-core dependencies on other FA packages', () => {
    withStaticFixture(
      {
        'packages/common-core/package.json': JSON.stringify({
          name: '@fa/common-core',
          private: true,
          exports: { '.': './src/index.ts' },
          dependencies: {
            '@fa/http-server': 'workspace:*',
          },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'packages/common-core/package.json common-core must not depend on @fa/http-server'
        );
      }
    );
  });

  it('rejects package imports from app paths and app package names', () => {
    withStaticFixture(
      {
        'packages/common-http/src/bad.ts':
          "import '../../../apps/chat-service/src/config.js';\nimport '@fa/chat-service';\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'packages/common-http/src/bad.ts must not import from apps/*',
            'packages/common-http/src/bad.ts must not import app package @fa/chat-service',
          ])
        );
      }
    );
  });

  it('rejects infra-firestore imports from http-server', () => {
    withStaticFixture(
      {
        'packages/infra-firestore/package.json': JSON.stringify({
          name: '@fa/infra-firestore',
          private: true,
          exports: { '.': './src/index.ts' },
        }),
        'packages/infra-firestore/src/health.ts':
          "import type { HealthCheck } from '@fa/http-server';\nexport type X = HealthCheck;\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'packages/infra-firestore/src/health.ts must not import @fa/http-server'
        );
      }
    );
  });

  it('requires backend apps to declare shared packages they import', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/server.ts':
          "import { createServiceApp } from '@fa/http-server';\nvoid createServiceApp;\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'apps/chat-service/package.json must declare dependency @fa/http-server imported by apps/chat-service/src/server.ts'
        );
      }
    );
  });

  it('requires Phase 3 migration files to have matching tests', () => {
    withStaticFixture(
      {
        'migrations/001_llm-usage-indexes.mjs': 'export const metadata = {};\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'Missing migration test for migrations/001_llm-usage-indexes.mjs: migrations/__tests__/001-llm-usage-indexes.test.ts'
        );
      }
    );
  });

  it('requires usage ingestion route and internal auth validation', () => {
    withStaticFixture(
      {
        'apps/llm-usage-service/src/routes/internalUsageRoutes.ts':
          "export function register(app: { post(path: string, handler: unknown): void }) { app.post('/internal/usage-events', () => undefined); }\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'apps/llm-usage-service/src/routes/internalUsageRoutes.ts must validate internal auth for POST /internal/usage-events'
        );
      }
    );
  });

  it('requires llm-usage-service to depend on infra-firestore', () => {
    withStaticFixture(
      {
        'apps/llm-usage-service/package.json': JSON.stringify({
          name: '@fa/llm-usage-service',
          private: true,
          dependencies: {
            '@fa/common-http': 'workspace:*',
          },
        }),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'apps/llm-usage-service/package.json must declare dependency @fa/infra-firestore'
        );
      }
    );
  });

  it('requires shared server runtime logging to be configurable and enabled by service entrypoints', () => {
    withStaticFixture(
      {
        'packages/http-server/src/createServiceApp.ts':
          "import fastify from 'fastify';\nexport function createServiceApp() { return fastify({ logger: false, disableRequestLogging: true }); }\n",
        'apps/chat-service/src/index.ts':
          "import { createServer } from './server.js';\nvoid createServer;\n",
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'packages/http-server/src/createServiceApp.ts must forward caller serverOptions into Fastify for runtime logging',
            'packages/http-server/src/createServiceApp.ts must not hard-code logger: false',
            'apps/chat-service/src/index.ts must enable structured runtime logging with createAppLogger and serverOptions.loggerInstance',
          ])
        );
      }
    );
  });

  it('requires prompt builders to be versioned in prompt content', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/domain/prompts/badPrompt.ts':
          'export const badPrompt = { build: () => ({ messages: [] }) };\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/chat-service/src/domain/prompts/badPrompt.ts must declare a semver prompt version',
            'apps/chat-service/src/domain/prompts/badPrompt.ts must include Prompt version in generated prompt content',
          ])
        );
      }
    );
  });

  it('requires prompt builders to be wired to assistant message prompt-version persistence', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/domain/prompts/fishingAnswerPrompt.ts':
          "export const fishingAnswerPrompt = { version: '2.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${fishingAnswerPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerGroundingPrompt.ts':
          "export const answerGroundingPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerGroundingPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/models/chat.ts':
          'export interface ConversationMessage { id: string; content: string; }\n',
        'packages/http-contracts/src/chatStream.ts':
          'export interface ChatStreamConversationMessage { id: string; content: string; }\n',
        'apps/chat-service/src/domain/usecases/streamChatMessage.ts':
          "import { fishingAnswerPrompt } from '../prompts/fishingAnswerPrompt.js';\nimport { answerGroundingPrompt } from '../prompts/answerGroundingPrompt.js';\nconst prompt = fishingAnswerPrompt.build();\nvoid prompt;\nvoid answerGroundingPrompt;\n",
        'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts':
          'export function messageToDoc(message) { return { ...message }; }\nfunction messageFromDoc(id, data) { return { id, content: data.content }; }\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/chat-service/src/domain/models/chat.ts ConversationMessage must expose optional promptVersions metadata',
            'packages/http-contracts/src/chatStream.ts ChatStreamConversationMessage must expose optional promptVersions metadata',
            'apps/chat-service/src/domain/usecases/streamChatMessage.ts must persist fishingAnswerPrompt.version in assistant promptVersions.answer',
            'apps/chat-service/src/domain/usecases/streamChatMessage.ts must persist answerGroundingPrompt.version in assistant promptVersions.grounding',
            'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts messageToDoc must write promptVersions',
            'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts messageFromDoc must read promptVersions',
          ])
        );
      }
    );
  });

  it('requires repair prompt metadata when an answer repair prompt exists', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/domain/prompts/fishingAnswerPrompt.ts':
          "export const fishingAnswerPrompt = { version: '2.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${fishingAnswerPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerGroundingPrompt.ts':
          "export const answerGroundingPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerGroundingPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerRepairPrompt.ts':
          "export const answerRepairPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerRepairPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/models/chat.ts':
          'export interface ConversationMessagePromptVersions { answer: { name: string; version: string }; grounding?: { name: string; version: string }; repair?: { name: string; version: string }; }\nexport interface ConversationMessage { id: string; content: string; promptVersions?: ConversationMessagePromptVersions; }\n',
        'packages/http-contracts/src/chatStream.ts':
          'export interface ChatStreamConversationMessagePromptVersions { answer: { name: string; version: string }; grounding?: { name: string; version: string }; repair?: { name: string; version: string }; }\nexport interface ChatStreamConversationMessage { id: string; content: string; promptVersions?: ChatStreamConversationMessagePromptVersions; }\n',
        'apps/chat-service/src/domain/usecases/streamChatMessage.ts':
          "import { fishingAnswerPrompt } from '../prompts/fishingAnswerPrompt.js';\nimport { answerGroundingPrompt } from '../prompts/answerGroundingPrompt.js';\nconst assistantMessage = { promptVersions: { answer: { name: 'fishing-answer', version: fishingAnswerPrompt.version }, grounding: { name: 'answer-grounding-check', version: answerGroundingPrompt.version } } };\nvoid assistantMessage;\n",
        'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts':
          'export function messageToDoc(message) { return { promptVersions: message.promptVersions }; }\nfunction messageFromDoc(id, data) { const promptVersions = data.promptVersions; return { id, ...(promptVersions !== undefined ? { promptVersions } : {}) }; }\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/chat-service/src/domain/usecases/streamChatMessage.ts must persist answerRepairPrompt.version in assistant promptVersions.repair when answerRepairPrompt exists',
          ])
        );
      }
    );
  });

  it('rejects repair prompt metadata that reuses the answer prompt version', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/domain/prompts/fishingAnswerPrompt.ts':
          "export const fishingAnswerPrompt = { version: '2.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${fishingAnswerPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerGroundingPrompt.ts':
          "export const answerGroundingPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerGroundingPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerRepairPrompt.ts':
          "export const answerRepairPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerRepairPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/models/chat.ts':
          'export interface ConversationMessagePromptVersions { answer: { name: string; version: string }; grounding?: { name: string; version: string }; repair?: { name: string; version: string }; }\nexport interface ConversationMessage { id: string; content: string; promptVersions?: ConversationMessagePromptVersions; }\n',
        'packages/http-contracts/src/chatStream.ts':
          'export interface ChatStreamConversationMessagePromptVersions { answer: { name: string; version: string }; grounding?: { name: string; version: string }; repair?: { name: string; version: string }; }\nexport interface ChatStreamConversationMessage { id: string; content: string; promptVersions?: ChatStreamConversationMessagePromptVersions; }\n',
        'apps/chat-service/src/domain/usecases/streamChatMessage.ts':
          "import { fishingAnswerPrompt } from '../prompts/fishingAnswerPrompt.js';\nimport { answerGroundingPrompt } from '../prompts/answerGroundingPrompt.js';\nimport { answerRepairPrompt } from '../prompts/answerRepairPrompt.js';\nconst assistantMessage = { promptVersions: { answer: { name: 'fishing-answer', version: fishingAnswerPrompt.version }, grounding: { name: 'answer-grounding-check', version: answerGroundingPrompt.version }, repair: { name: 'answer-repair', version: fishingAnswerPrompt.version } } };\nvoid assistantMessage;\nvoid answerRepairPrompt;\n",
        'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts':
          'export function messageToDoc(message) { return { promptVersions: message.promptVersions }; }\nfunction messageFromDoc(id, data) { const promptVersions = data.promptVersions; return { id, ...(promptVersions !== undefined ? { promptVersions } : {}) }; }\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'apps/chat-service/src/domain/usecases/streamChatMessage.ts must persist answerRepairPrompt.version in assistant promptVersions.repair when answerRepairPrompt exists',
          ])
        );
      }
    );
  });

  it('accepts prompt-version persistence wiring when prompt builders exist', () => {
    withStaticFixture(
      {
        'apps/chat-service/src/domain/prompts/fishingAnswerPrompt.ts':
          "export const fishingAnswerPrompt = { version: '2.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${fishingAnswerPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerGroundingPrompt.ts':
          "export const answerGroundingPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerGroundingPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/prompts/answerRepairPrompt.ts':
          "export const answerRepairPrompt = { version: '1.0.0', build: () => ({ messages: [{ role: 'user', content: `Prompt version: ${answerRepairPrompt.version}` }] }) };\n",
        'apps/chat-service/src/domain/models/chat.ts':
          'export interface ConversationMessagePromptVersions { answer: { name: string; version: string }; grounding?: { name: string; version: string }; repair?: { name: string; version: string }; }\nexport interface ConversationMessage { id: string; content: string; promptVersions?: ConversationMessagePromptVersions; }\n',
        'packages/http-contracts/src/chatStream.ts':
          'export interface ChatStreamConversationMessagePromptVersions { answer: { name: string; version: string }; grounding?: { name: string; version: string }; repair?: { name: string; version: string }; }\nexport interface ChatStreamConversationMessage { id: string; content: string; promptVersions?: ChatStreamConversationMessagePromptVersions; }\n',
        'apps/chat-service/src/domain/usecases/streamChatMessage.ts':
          "import { fishingAnswerPrompt } from '../prompts/fishingAnswerPrompt.js';\nimport { answerGroundingPrompt } from '../prompts/answerGroundingPrompt.js';\nimport { answerRepairPrompt } from '../prompts/answerRepairPrompt.js';\nconst assistantMessage = { promptVersions: { answer: { name: 'fishing-answer', version: fishingAnswerPrompt.version }, grounding: { name: 'answer-grounding-check', version: answerGroundingPrompt.version }, repair: { name: 'answer-repair', version: answerRepairPrompt.version } } };\nvoid assistantMessage;\n",
        'apps/chat-service/src/infra/firestore/firestoreConversationMessageRepository.ts':
          'export function messageToDoc(message) { return { promptVersions: message.promptVersions }; }\nfunction messageFromDoc(id, data) { const promptVersions = data.promptVersions; return { id, ...(promptVersions !== undefined ? { promptVersions } : {}) }; }\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual([]);
      }
    );
  });

  it('requires deployment, Terraform, Docker, smoke, and webhook artifacts for MVP finalization', () => {
    withStaticFixture(
      {
        'scripts/bootstrap/bootstrap-gcp-data-plane.sh': null,
        'scripts/deploy/deploy-dev.sh': null,
        'scripts/dev-host/fa-pm2.service': null,
        'scripts/dev-host/webhook-handler.mjs': null,
        'scripts/dev-host/caddy/fishing-assistant.Caddyfile': null,
        'scripts/hetzner/reload-services-container.sh': null,
        'scripts/hetzner/nginx/fishing-assistant.conf': null,
        'scripts/hetzner/nginx/fishing-assistant.origin-http.conf': null,
        'scripts/smoke/auth0-authorize-preflight.mjs': null,
        'scripts/smoke/e2e-dev.mjs': null,
        'docker/prod/Dockerfile': null,
        'terraform/gcp-data-plane/main.tf': null,
        'terraform/hetzner-prod/hetzner.tf': null,
        '.github/workflows/deploy.yml': null,
        'docs/operations/fa-mvp-runbook.md': null,
        'docs/operations/fa-observability-runbook.md': null,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'Missing deployment artifact: scripts/bootstrap/bootstrap-gcp-data-plane.sh',
            'Missing deployment artifact: scripts/deploy/deploy-dev.sh',
            'Missing deployment artifact: scripts/dev-host/fa-pm2.service',
            'Missing deployment artifact: scripts/dev-host/webhook-handler.mjs',
            'Missing deployment artifact: scripts/dev-host/caddy/fishing-assistant.Caddyfile',
            'Missing deployment artifact: scripts/hetzner/reload-services-container.sh',
            'Missing deployment artifact: scripts/hetzner/nginx/fishing-assistant.conf',
            'Missing deployment artifact: scripts/hetzner/nginx/fishing-assistant.origin-http.conf',
            'Missing deployment artifact: scripts/smoke/auth0-authorize-preflight.mjs',
            'Missing deployment artifact: scripts/smoke/e2e-dev.mjs',
            'Missing deployment artifact: docker/prod/Dockerfile',
            'Missing deployment artifact: terraform/gcp-data-plane/main.tf',
            'Missing deployment artifact: terraform/hetzner-prod/hetzner.tf',
            'Missing deployment artifact: .github/workflows/deploy.yml',
            'Missing deployment artifact: docs/operations/fa-mvp-runbook.md',
            'Missing deployment artifact: docs/operations/fa-observability-runbook.md',
          ])
        );
      }
    );
  });

  it('requires Grafana observability install and alert-router deployment artifacts', () => {
    withStaticFixture(
      {
        'scripts/observability/fa-alloy.service': null,
        'scripts/observability/install-alloy.sh': null,
        'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile': null,
        'scripts/dev-host/fa-alert-router.service': null,
        'scripts/hetzner/fa-alert-router.service': null,
        'scripts/hetzner/load-observability-env.sh': null,
        'scripts/hetzner/install-observability.sh': null,
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': null,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'Missing deployment artifact: scripts/observability/fa-alloy.service',
            'Missing deployment artifact: scripts/observability/install-alloy.sh',
            'Missing deployment artifact: scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile',
            'Missing deployment artifact: scripts/dev-host/fa-alert-router.service',
            'Missing deployment artifact: scripts/hetzner/fa-alert-router.service',
            'Missing deployment artifact: scripts/hetzner/load-observability-env.sh',
            'Missing deployment artifact: scripts/hetzner/install-observability.sh',
            'Missing deployment artifact: terraform/hetzner-prod/cloud-init.yaml.tftpl',
          ])
        );
      }
    );
  });

  it('rejects the DEV FA Caddy site snippet when homepage edge auth is reintroduced', () => {
    withStaticFixture(
      {
        'scripts/dev-host/caddy/fishing-assistant.Caddyfile':
          'basic_auth { fa {$FA_SITE_BASIC_AUTH_CADDY_HASH} }\nhandle / { reverse_proxy localhost:3100 }\nhandle_path /api/users/* { reverse_proxy localhost:3204 }\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/dev-host/caddy/fishing-assistant.Caddyfile must serve the public homepage without an edge auth gate',
          ])
        );
      }
    );
  });

  it('rejects FA Alloy units that use the host Alloy default HTTP port', () => {
    withStaticFixture(
      {
        'scripts/observability/fa-alloy.service': [
          '[Service]',
          'EnvironmentFile=-/etc/fa/observability.env',
          'ExecStart=/usr/bin/alloy run /etc/fa/alloy/fa.alloy',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/observability/fa-alloy.service must run Alloy with --server.http.listen-addr=127.0.0.1:12346 so it does not conflict with the host alloy.service'
        );
      }
    );
  });

  it('rejects unsafe Grafana observability install and routing wiring', () => {
    withStaticFixture(
      {
        'scripts/observability/fa-alloy.service': [
          '[Service]',
          'User=deploy',
          'ExecStart=/usr/bin/alloy run /tmp/fa.alloy',
          '',
        ].join('\n'),
        'scripts/observability/install-alloy.sh':
          '#!/usr/bin/env bash\nFA_GRAFANA_LOKI_TOKEN=hard-coded-token\nsystemctl restart fa-alloy\n',
        'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile':
          'handle /alerts/grafana* {\n    reverse_proxy localhost:9002\n}\n',
        'scripts/dev-host/fa-alert-router.service':
          '[Service]\nEnvironment=PORT=9002\nExecStart=/usr/bin/node router.mjs\n',
        'scripts/hetzner/fa-alert-router.service': [
          '[Service]',
          'Environment=FA_ALERT_ROUTER_BIND_HOST=0.0.0.0',
          'Environment=PORT=9002',
          'ExecStart=/usr/bin/node /opt/fishing-assistant/current/scripts/observability/alert-router.mjs',
          '',
        ].join('\n'),
        'scripts/hetzner/install-observability.sh':
          '#!/usr/bin/env bash\nnode scripts/observability/render-alloy-config.mjs --environment prod\n',
        'docs/operations/fa-mvp-runbook.md': '# FA MVP Runbook\n',
        'docs/operations/fa-observability-runbook.md': '# FA Observability Runbook\n',
        'scripts/hetzner/provision.sh': '#!/usr/bin/env bash\ninstall -d -m 755 /etc/fa\n',
        'terraform/hetzner-prod/cloud-init.yaml.tftpl':
          '#cloud-config\nruncmd:\n  - touch /etc/fa/observability.env\n  - chmod 0644 /etc/fa/observability.env\n',
        'terraform/hetzner-prod/hetzner.tf': 'resource "hcloud_server" "prod" {}\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/observability/fa-alloy.service must use EnvironmentFile=-/etc/fa/observability.env',
            'scripts/observability/fa-alloy.service must run /usr/bin/alloy against /etc/fa/alloy/fa.alloy',
            'scripts/observability/fa-alloy.service must run Alloy with --server.http.listen-addr=127.0.0.1:12346 so it does not conflict with the host alloy.service',
            'scripts/observability/fa-alloy.service must run as root for journal/docker access or use a dedicated alloy user',
            'scripts/observability/install-alloy.sh must create /etc/fa/alloy, render config, install the fa-alloy unit, reload systemd, and enable/restart fa-alloy',
            'scripts/observability/install-alloy.sh must add the alloy user to the docker group before restarting fa-alloy',
            'scripts/observability/install-alloy.sh must not hard-code Grafana Loki tokens or alert-router secrets',
            'scripts/observability/install-alloy.sh must fail --with-alert-router when scripts/observability/alert-router.mjs is missing',
            'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile must respond ok on /healthz',
            'scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile must proxy /alerts/grafana to 127.0.0.1:9002',
            'scripts/dev-host/fa-alert-router.service must bind fa-alert-router to 127.0.0.1:9002, use /etc/fa/observability.env, and log to journald',
            'scripts/dev-host/fa-alert-router.service must run as User=fa-deploy for DEV deploy ownership and env access',
            'scripts/dev-host/fa-alert-router.service must use FA_DEV_DEPLOY_ROOT from /etc/fa/observability.env instead of checked-in home-directory deploy paths',
            'scripts/dev-host/fa-alert-router.service must run fa-alert-router as an unprivileged user with basic systemd hardening',
            'scripts/hetzner/fa-alert-router.service must bind fa-alert-router to 127.0.0.1:9002, use /etc/fa/observability.env, and log to journald',
            'scripts/hetzner/fa-alert-router.service must run fa-alert-router as an unprivileged user with basic systemd hardening',
            'scripts/hetzner/install-observability.sh must create /etc/fa/alloy, render config, install the fa-alloy unit, reload systemd, and enable/restart fa-alloy',
            'scripts/hetzner/install-observability.sh must add the alloy user to the docker group before restarting fa-alloy',
            'scripts/hetzner/install-observability.sh must install and enable fa-alert-router when --with-alert-router is passed',
            'scripts/hetzner/install-observability.sh must fail --with-alert-router when scripts/observability/alert-router.mjs is missing',
            'docs/operations/fa-mvp-runbook.md must explain copying the DEV observability Caddy snippet into the host-level Caddy site',
            'scripts/hetzner/provision.sh must create /etc/fa/observability.env with mode 0640 or stricter',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl must create /etc/fa/observability.env with mode 0640 or stricter',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl must install deploy_ssh_public_key for the deploy user',
            'terraform/hetzner-prod/hetzner.tf must pass var.deploy_ssh_public_key into the cloud-init template',
          ])
        );
      }
    );
  });

  it('rejects DEV alert-router units that use checked-in deploy paths', () => {
    const homeDeployPath = `/${['home', 'operator', 'deploy', 'fishing-assistant'].join('/')}`;

    for (const [name, workingDirectory, execStart] of [
      [
        'systemd-home-specifier',
        '%h/deploy/fishing-assistant',
        '/usr/bin/node %h/deploy/fishing-assistant/scripts/observability/alert-router.mjs',
      ],
      [
        'checked-in-home-directory',
        homeDeployPath,
        `/usr/bin/node ${homeDeployPath}/scripts/observability/alert-router.mjs`,
      ],
    ] as const) {
      withStaticFixture(
        {
          'scripts/dev-host/fa-alert-router.service': [
            '[Service]',
            'Environment=FA_ALERT_ROUTER_BIND_HOST=127.0.0.1',
            'Environment=PORT=9002',
            'EnvironmentFile=-/etc/fa/observability.env',
            'User=fa-deploy',
            `WorkingDirectory=${workingDirectory}`,
            `ExecStart=${execStart}`,
            `SyslogIdentifier=fa-alert-router-${name}`,
            'StandardOutput=journal',
            'StandardError=journal',
            'NoNewPrivileges=true',
            'PrivateTmp=true',
            '',
          ].join('\n'),
        },
        (root) => {
          expect(validateStaticRepository(root)).toContain(
            'scripts/dev-host/fa-alert-router.service must use FA_DEV_DEPLOY_ROOT from /etc/fa/observability.env instead of checked-in home-directory deploy paths'
          );
        }
      );
    }
  }, 15_000);

  it('rejects deploy workflows that do not require PROD refs to be on main', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': [
          'name: deploy',
          'jobs:',
          '  deploy:',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          "          ref: ${{ inputs.ref || 'main' }}",
          '          fetch-depth: 0',
          '      - name: Deploy PROD to Hetzner',
          "        if: ${{ inputs.environment == 'prod' }}",
          '        run: bash scripts/hetzner/github-actions-deploy.sh',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/deploy.yml must require PROD deploy refs to be ancestors of origin/main unless allow_unmerged_prod_ref is explicitly true'
        );
      }
    );
  });

  it('rejects deploy workflows without an explicit unmerged PROD debug override input', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': deployWorkflowWithProdMainAncestryCheck.replace(
          [
            '      allow_unmerged_prod_ref:',
            '        description: Allow temporary production deploys from refs not merged to main',
            '        type: boolean',
            '        required: false',
            '        default: false',
          ].join('\n') + '\n',
          ''
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/deploy.yml must define allow_unmerged_prod_ref workflow_dispatch input with default false'
        );
      }
    );
  });

  it('rejects PROD ancestry checks that ignore the explicit unmerged-ref override input', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': deployWorkflowWithProdMainAncestryCheck.replace(
          "        if: ${{ inputs.environment == 'prod' && inputs.allow_unmerged_prod_ref != true }}",
          "        if: ${{ inputs.environment == 'prod' }}"
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/deploy.yml must require PROD deploy refs to be ancestors of origin/main unless allow_unmerged_prod_ref is explicitly true'
        );
      }
    );
  });

  it('rejects commented-out PROD ancestry checks', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': [
          'name: deploy',
          'jobs:',
          '  deploy:',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          "          ref: ${{ inputs.ref || 'main' }}",
          '          fetch-depth: 0',
          '      - name: Require PROD deploy ref on main',
          "        if: ${{ inputs.environment == 'prod' }}",
          '        run: |',
          '          # deploy_sha="$(git rev-parse HEAD)"',
          '          # git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main',
          '          # main_sha="$(git rev-parse --verify refs/remotes/origin/main)"',
          '          # git merge-base --is-ancestor "$deploy_sha" "$main_sha"',
          '          echo unchecked',
          '      - name: Deploy PROD to Hetzner',
          "        if: ${{ inputs.environment == 'prod' }}",
          '        run: bash scripts/hetzner/github-actions-deploy.sh',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/deploy.yml must require PROD deploy refs to be ancestors of origin/main unless allow_unmerged_prod_ref is explicitly true'
        );
      }
    );
  });

  it('rejects ancestry checks that are not gated to PROD before the PROD deploy step', () => {
    const expectedError =
      '.github/workflows/deploy.yml must require PROD deploy refs to be ancestors of origin/main unless allow_unmerged_prod_ref is explicitly true';

    for (const [name, condition] of [
      ['dev-only', "        if: ${{ inputs.environment == 'dev' }}"],
      ['unconditional', ''],
    ] as const) {
      withStaticFixture(
        {
          '.github/workflows/deploy.yml': [
            'name: deploy',
            'jobs:',
            '  deploy:',
            '    steps:',
            '      - uses: actions/checkout@v4',
            '        with:',
            "          ref: ${{ inputs.ref || 'main' }}",
            '          fetch-depth: 0',
            '      - name: Check deploy ref',
            condition,
            '        run: |',
            '          deploy_sha="$(git rev-parse HEAD)"',
            '          git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main',
            '          main_sha="$(git rev-parse --verify refs/remotes/origin/main)"',
            '          if ! git merge-base --is-ancestor "$deploy_sha" "$main_sha"; then',
            '            exit 1',
            '          fi',
            '      - name: Deploy PROD to Hetzner',
            "        if: ${{ inputs.environment == 'prod' }}",
            `        run: echo ${name} && bash scripts/hetzner/github-actions-deploy.sh`,
            '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        (root) => {
          expect(validateStaticRepository(root)).toContain(expectedError);
        }
      );
    }
  });

  it('rejects PROD ancestry checks that run after the PROD deploy step', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': [
          'name: deploy',
          'jobs:',
          '  deploy:',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '        with:',
          "          ref: ${{ inputs.ref || 'main' }}",
          '          fetch-depth: 0',
          '      - name: Deploy PROD to Hetzner',
          "        if: ${{ inputs.environment == 'prod' }}",
          '        run: bash scripts/hetzner/github-actions-deploy.sh',
          '      - name: Require PROD deploy ref on main',
          "        if: ${{ inputs.environment == 'prod' }}",
          '        run: |',
          '          deploy_sha="$(git rev-parse HEAD)"',
          '          git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main',
          '          main_sha="$(git rev-parse --verify refs/remotes/origin/main)"',
          '          if ! git merge-base --is-ancestor "$deploy_sha" "$main_sha"; then',
          '            exit 1',
          '          fi',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/deploy.yml must require PROD deploy refs to be ancestors of origin/main unless allow_unmerged_prod_ref is explicitly true'
        );
      }
    );
  });

  it('requires the PROD workflow to pass the pinned Hetzner host key fingerprint secret', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': deployWorkflowWithProdMainAncestryCheck.replace(
          '          FA_HETZNER_PROD_HOST_KEY_SHA256: ${{ secrets.FA_HETZNER_PROD_HOST_KEY_SHA256 }}\n',
          ''
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/deploy.yml must pass FA_HETZNER_PROD_HOST_KEY_SHA256 from GitHub secrets to the PROD deploy step'
        );
      }
    );
  });

  it('rejects edge health checks gated by deploy_nginx in the Hetzner deploy script', () => {
    const unsafeDeployScript = githubActionsDeployWithPinnedHostTrust.replace(
      [
        'verify_deployment() {',
        '  verify_service_health',
        '  verify_observability_health',
        '  verify_local_origin_health',
        '  if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]; then',
        '    printf "Skipping HTTPS edge health checks for bootstrap origin HTTP mode\\n"',
        '  else',
        '    verify_https_edge_health',
        '  fi',
        '}',
      ].join('\n'),
      [
        'verify_deployment() {',
        '  verify_service_health',
        '  if [[ "${deploy_nginx}" == "true" ]]; then',
        '    verify_https_edge_health',
        '  fi',
        '}',
      ].join('\n')
    );

    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': unsafeDeployScript,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/github-actions-deploy.sh must run HTTPS edge health checks by default; deploy_nginx may only control nginx publish/reload'
        );
      }
    );
  });

  it('rejects deploy workflow bootstrap origin input omissions and missing script flag wiring', () => {
    const workflowWithoutBootstrapEscapeHatch = deployWorkflowWithProdMainAncestryCheck
      .replace(
        [
          'on:',
          '  workflow_dispatch:',
          '    inputs:',
          '      bootstrap_origin_http_only:',
          '        description: Bootstrap the production origin over HTTP before Cloudflare DNS/TLS is ready',
          '        type: boolean',
          '        required: false',
          '        default: false',
        ].join('\n'),
        'on:\n  workflow_dispatch:\n    inputs:'
      )
      .replace(
        [
          '          if [[ "${{ inputs.bootstrap_origin_http_only }}" == "true" ]]; then',
          '            args+=(--bootstrap-origin-http-only)',
          '          fi',
        ].join('\n'),
        '          echo "no bootstrap origin flag"'
      );

    withStaticFixture(
      {
        '.github/workflows/deploy.yml': workflowWithoutBootstrapEscapeHatch,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            '.github/workflows/deploy.yml must define bootstrap_origin_http_only workflow_dispatch input with default false',
            '.github/workflows/deploy.yml must pass --bootstrap-origin-http-only to the PROD deploy script only when bootstrap_origin_http_only is true',
          ])
        );
      }
    );
  });

  it('rejects bootstrap origin mode controlled by ambient deploy environment', () => {
    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': githubActionsDeployWithPinnedHostTrust.replace(
          'deploy_bootstrap_origin_http_only=false',
          'deploy_bootstrap_origin_http_only="${FA_DEPLOY_BOOTSTRAP_ORIGIN_HTTP_ONLY:-false}"'
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/github-actions-deploy.sh must initialize deploy_bootstrap_origin_http_only=false and set it only from --bootstrap-origin-http-only'
        );
      }
    );
  });

  it('rejects production edge health checks that do not assert HTTP 200 status codes', () => {
    const deployScriptWithFailOnlyCurl = githubActionsDeployWithPinnedHostTrust.replaceAll(
      "--write-out '%{http_code}'",
      ''
    );

    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': deployScriptWithFailOnlyCurl,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/github-actions-deploy.sh must assert HTTP 200 for local origin health checks instead of accepting curl --fail redirects',
            'scripts/hetzner/github-actions-deploy.sh must assert HTTP 200 for HTTPS edge health checks',
          ])
        );
      }
    );
  });

  it('rejects bootstrap origin mode without local origin API health checks', () => {
    const deployScriptWithoutLocalOriginApiHealth = githubActionsDeployWithPinnedHostTrust
      .replace('    assert_remote_http_200 http://127.0.0.1/api/chat/health\n', '')
      .replace('    assert_remote_http_200 http://127.0.0.1/api/knowledge/health\n', '')
      .replace('    assert_remote_http_200 http://127.0.0.1/api/llm-usage/health\n', '')
      .replace('    assert_remote_http_200 http://127.0.0.1/api/users/health\n', '');

    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': deployScriptWithoutLocalOriginApiHealth,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/github-actions-deploy.sh must run local origin health checks for /healthz and /api/{chat,knowledge,llm-usage,users}/health in every deployment'
        );
      }
    );
  });

  it('requires the Hetzner deploy script to pin scanned host keys to a SHA256 fingerprint', () => {
    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': [
          '#!/usr/bin/env bash',
          'FA_HETZNER_PROD_HOST="${FA_HETZNER_PROD_HOST:-}"',
          'KNOWN_HOSTS_FILE="$(mktemp)"',
          'ssh-keyscan -H "${FA_HETZNER_PROD_HOST}" > "${KNOWN_HOSTS_FILE}"',
          'ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}" deploy@example true',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/github-actions-deploy.sh must require FA_HETZNER_PROD_HOST_KEY_SHA256',
            'scripts/hetzner/github-actions-deploy.sh must require ssh-keygen before deploying',
            'scripts/hetzner/github-actions-deploy.sh must validate ssh-keyscan output with ssh-keygen -lf -',
          ])
        );
      }
    );
  });

  it('rejects deploy scripts that append raw ssh-keyscan output to known_hosts', () => {
    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': githubActionsDeployWithPinnedHostTrust.replace(
          'ssh-keyscan -p "${FA_HETZNER_SSH_PORT}" -H "${FA_HETZNER_PROD_HOST}" > "${temp_scan_file}"',
          'ssh-keyscan -p "${FA_HETZNER_SSH_PORT}" -H "${FA_HETZNER_PROD_HOST}" >> "${known_hosts_file}"'
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/github-actions-deploy.sh must not append ssh-keyscan output directly to known_hosts'
        );
      }
    );
  });

  it('rejects deploy scripts that use trust-on-first-use SSH host key modes', () => {
    const expectedError =
      'scripts/hetzner/github-actions-deploy.sh must not disable StrictHostKeyChecking or use accept-new';

    for (const mode of ['no', 'accept-new']) {
      withStaticFixture(
        {
          'scripts/hetzner/github-actions-deploy.sh':
            githubActionsDeployWithPinnedHostTrust.replaceAll(
              'StrictHostKeyChecking=yes',
              `StrictHostKeyChecking=${mode}`
            ),
        },
        (root) => {
          expect(validateStaticRepository(root)).toContain(expectedError);
        }
      );
    }
  });

  it('rejects production provisioning that grants broad deploy-user sudo', () => {
    withStaticFixture(
      {
        'scripts/hetzner/provision.sh': [
          '#!/usr/bin/env bash',
          'deploy_user="${deploy_user:-deploy}"',
          'usermod -aG sudo,docker "${deploy_user}"',
          'printf "%s ALL=(ALL) NOPASSWD:ALL\\n" "${deploy_user}" > "/etc/sudoers.d/90-fa-${deploy_user}"',
          '',
        ].join('\n'),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': [
          '#cloud-config',
          'users:',
          '  - name: deploy',
          '    groups: [sudo, docker]',
          '    sudo: ALL=(ALL) NOPASSWD:ALL',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/provision.sh must not grant deploy user NOPASSWD:ALL',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl must not grant deploy user NOPASSWD:ALL',
          ])
        );
      }
    );
  });

  it('rejects relative sudo bash calls for privileged production deploy scripts', () => {
    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': githubActionsDeployWithPinnedHostTrust.replace(
          prodLoadSecretsWrapperCall,
          'sudo -n FA_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/github-actions-deploy.sh must use fixed sudo wrapper paths instead of relative sudo bash scripts'
        );
      }
    );
  });

  it('requires production deploys to call the fixed sudo wrapper commands', () => {
    withStaticFixture(
      {
        'scripts/hetzner/github-actions-deploy.sh': githubActionsDeployWithPinnedHostTrust
          .replace(prodLoadSecretsWrapperCall, 'echo no secrets')
          .replace('sudo -n /usr/local/sbin/fa-deploy-nginx "${release_dir}"', 'echo no nginx'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/github-actions-deploy.sh must call /usr/local/sbin/fa-load-secrets',
            'scripts/hetzner/github-actions-deploy.sh must call /usr/local/sbin/fa-deploy-nginx',
          ])
        );
      }
    );
  });

  it('rejects sudo wrappers that execute deploy-owned release scripts as root', () => {
    withStaticFixture(
      {
        'scripts/hetzner/provision.sh': provisionWithDeployOwnedScriptExecution,
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': cloudInitWithDeployOwnedScriptExecution,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/provision.sh sudo wrappers must not execute deploy-owned scripts/hetzner/*.sh as root',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl sudo wrappers must not execute deploy-owned scripts/hetzner/*.sh as root',
          ])
        );
      }
    );
  });

  it('requires nginx sudo wrappers to canonicalize checked-in config source paths', () => {
    withStaticFixture(
      {
        'scripts/hetzner/provision.sh': provisionWithUncanonicalizedNginxSource,
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': cloudInitWithUncanonicalizedNginxSource,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/provision.sh fa-deploy-nginx wrapper must canonicalize nginx config sources with realpath -e',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl fa-deploy-nginx wrapper must canonicalize nginx config sources with realpath -e',
          ])
        );
      }
    );
  });

  it('requires production sudo wrappers to canonicalize and constrain release paths', () => {
    withStaticFixture(
      {
        'scripts/hetzner/provision.sh': provisionWithNarrowSudoWrappers.replaceAll(
          'realpath -e',
          'readlink -f'
        ),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': cloudInitWithNarrowSudoWrappers.replaceAll(
          'realpath -e',
          'readlink -f'
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/provision.sh must install sudo wrappers that canonicalize release paths with realpath -e',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl must install sudo wrappers that canonicalize release paths with realpath -e',
          ])
        );
      }
    );
  });

  it('rejects Cloudflare DNS token in runtime env generation and runtime secret sets', () => {
    withStaticFixture(
      {
        '.env.example': 'FA_CLOUDFLARE_DNS_API_TOKEN=\n',
        '.env.prod.example': 'FA_CLOUDFLARE_DNS_API_TOKEN=\n',
        'scripts/hetzner/load-secrets.sh': loadSecretsWithDirectRuntimeDnsTokenWrite,
        'scripts/hetzner/provision.sh': `${provisionWithNarrowSudoWrappers}\n${loadSecretsWithRuntimeDnsToken}`,
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': `${cloudInitWithNarrowSudoWrappers}\n${loadSecretsWithRuntimeDnsToken}`,
        'scripts/hetzner/reload-services-container.sh':
          'docker run --env-file /etc/fa/.env.prod -e FA_CLOUDFLARE_DNS_API_TOKEN=bad fa-services:abc\n',
        'ecosystem.config.prod.cjs':
          'module.exports = { apps: [{ env: { FA_CLOUDFLARE_DNS_API_TOKEN: process.env.FA_CLOUDFLARE_DNS_API_TOKEN } }] };\n',
        'docker/prod/Dockerfile': 'ENV FA_CLOUDFLARE_DNS_API_TOKEN=bad\n',
        'apps/web/src/config.generated.ts': "export const bad = 'FA_CLOUDFLARE_DNS_API_TOKEN';\n",
        'ecosystem.generated.cjs': "module.exports = { FA_CLOUDFLARE_DNS_API_TOKEN: 'bad' };\n",
        'terraform/hetzner-prod/service-urls.auto.tfvars.json':
          '{"FA_CLOUDFLARE_DNS_API_TOKEN":"bad"}\n',
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithRuntimeDnsToken,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            '.env.example must not define FA_CLOUDFLARE_DNS_API_TOKEN; DNS token is provisioning-only',
            '.env.prod.example must not define FA_CLOUDFLARE_DNS_API_TOKEN; DNS token is provisioning-only',
            'scripts/hetzner/load-secrets.sh must not include FA_CLOUDFLARE_DNS_API_TOKEN in runtime env generation',
            'scripts/hetzner/provision.sh fa-load-secrets wrapper must not include FA_CLOUDFLARE_DNS_API_TOKEN in FA_RUNTIME_SECRETS',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl fa-load-secrets wrapper must not include FA_CLOUDFLARE_DNS_API_TOKEN in FA_RUNTIME_SECRETS',
            'scripts/hetzner/reload-services-container.sh must not expose FA_CLOUDFLARE_DNS_API_TOKEN to runtime containers',
            'ecosystem.config.prod.cjs must not expose FA_CLOUDFLARE_DNS_API_TOKEN to production PM2 env',
            'docker/prod/Dockerfile must not expose FA_CLOUDFLARE_DNS_API_TOKEN to production image env',
            'apps/web/src/config.generated.ts must not expose FA_CLOUDFLARE_DNS_API_TOKEN to browser/runtime config',
            'ecosystem.generated.cjs must not expose FA_CLOUDFLARE_DNS_API_TOKEN to generated runtime config',
            'terraform/hetzner-prod/service-urls.auto.tfvars.json must not expose FA_CLOUDFLARE_DNS_API_TOKEN to Terraform runtime wiring',
            'terraform/gcp-data-plane/main.tf must define FA_CLOUDFLARE_DNS_API_TOKEN in provisioning_secret_names, not runtime secret_names',
          ])
        );
      }
    );
  });

  it('rejects browser-safe Auth0 values in Secret Manager runtime sets', () => {
    withStaticFixture(
      {
        'scripts/hetzner/load-secrets.sh': [
          '#!/usr/bin/env bash',
          'FA_RUNTIME_SECRETS=(',
          '  FA_INTERNAL_AUTH_TOKEN',
          '  FA_AUTH0_DOMAIN',
          '  FA_AUTH0_CLIENT_ID',
          '  FA_AUTH0_AUDIENCE',
          '  FA_AUTH0_ISSUER',
          '  FA_AUTH0_JWKS_URI',
          ')',
          '',
        ].join('\n'),
        'scripts/hetzner/provision.sh': [
          provisionWithNarrowSudoWrappers,
          'FA_RUNTIME_SECRETS=(',
          '  FA_AUTH0_DOMAIN',
          '  FA_AUTH0_CLIENT_ID',
          '  FA_AUTH0_AUDIENCE',
          ')',
          '',
        ].join('\n'),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': [
          cloudInitWithNarrowSudoWrappers,
          'FA_RUNTIME_SECRETS=(',
          '  FA_AUTH0_DOMAIN',
          '  FA_AUTH0_CLIENT_ID',
          '  FA_AUTH0_AUDIENCE',
          ')',
          '',
        ].join('\n'),
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithProvisioningDnsToken.replace(
          '"FA_INTERNAL_AUTH_TOKEN",',
          [
            '"FA_INTERNAL_AUTH_TOKEN",',
            '"FA_AUTH0_DOMAIN",',
            '"FA_AUTH0_CLIENT_ID",',
            '"FA_AUTH0_AUDIENCE",',
          ].join('\n')
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/load-secrets.sh must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: FA_AUTH0_DOMAIN',
            'scripts/hetzner/load-secrets.sh must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: FA_AUTH0_CLIENT_ID',
            'scripts/hetzner/load-secrets.sh must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: FA_AUTH0_AUDIENCE',
            'scripts/hetzner/provision.sh fa-load-secrets wrapper must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: FA_AUTH0_DOMAIN',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl fa-load-secrets wrapper must not include browser-safe Auth0 runtime config in FA_RUNTIME_SECRETS: FA_AUTH0_DOMAIN',
            'terraform/gcp-data-plane/main.tf must not define browser-safe Auth0 runtime config as Secret Manager runtime secrets: FA_AUTH0_DOMAIN',
            'terraform/gcp-data-plane/main.tf must not define browser-safe Auth0 runtime config as Secret Manager runtime secrets: FA_AUTH0_CLIENT_ID',
            'terraform/gcp-data-plane/main.tf must not define browser-safe Auth0 runtime config as Secret Manager runtime secrets: FA_AUTH0_AUDIENCE',
          ])
        );
      }
    );
  });

  it('rejects production deploy wiring that omits browser-safe Auth0 GitHub vars or wrapper arguments', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': deployWorkflowWithProdMainAncestryCheck
          .replace('          FA_AUTH0_DOMAIN: ${{ vars.FA_AUTH0_DOMAIN }}\n', '')
          .replace('          FA_AUTH0_CLIENT_ID: ${{ vars.FA_AUTH0_CLIENT_ID }}\n', '')
          .replace('          FA_AUTH0_AUDIENCE: ${{ vars.FA_AUTH0_AUDIENCE }}\n', ''),
        'scripts/hetzner/github-actions-deploy.sh': githubActionsDeployWithPinnedHostTrust
          .replace('  [[ -n "${FA_AUTH0_DOMAIN}" ]] || fail "FA_AUTH0_DOMAIN is required"\n', '')
          .replace(
            '  [[ -n "${FA_AUTH0_CLIENT_ID}" ]] || fail "FA_AUTH0_CLIENT_ID is required"\n',
            ''
          )
          .replace(
            '  [[ -n "${FA_AUTH0_AUDIENCE}" ]] || fail "FA_AUTH0_AUDIENCE is required"\n',
            ''
          )
          .replace(
            prodLoadSecretsWrapperCall,
            'sudo -n /usr/local/sbin/fa-load-secrets "${release_dir}"'
          ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            '.github/workflows/deploy.yml must pass browser-safe FA_AUTH0_DOMAIN from GitHub vars to the PROD deploy step',
            '.github/workflows/deploy.yml must pass browser-safe FA_AUTH0_CLIENT_ID from GitHub vars to the PROD deploy step',
            '.github/workflows/deploy.yml must pass browser-safe FA_AUTH0_AUDIENCE from GitHub vars to the PROD deploy step',
            'scripts/hetzner/github-actions-deploy.sh must pass browser-safe Auth0 runtime config to fa-load-secrets through explicit wrapper arguments',
          ])
        );
      }
    );
  });

  it('requires environment-specific OpenRouter Secret Manager sources for local and prod rotation', () => {
    withStaticFixture(
      {
        'scripts/pull-local-env.mjs':
          "const requiredSecretNames = ['FA_OPENROUTER_APP_API_KEY'];\n",
        'scripts/hetzner/load-secrets.sh': [
          '#!/usr/bin/env bash',
          'FA_RUNTIME_SECRETS=(',
          '  FA_INTERNAL_AUTH_TOKEN',
          '  FA_OPENROUTER_APP_API_KEY',
          ')',
          'append_secret "${temp_env_file}" FA_OPENROUTER_APP_API_KEY',
          '',
        ].join('\n'),
        'scripts/hetzner/provision.sh': [
          provisionWithNarrowSudoWrappers
            .replace('FA_PROD_OPENROUTER_APP_API_KEY=FA_OPENROUTER_APP_API_KEY\n', '')
            .replace('FA_PROD_MINIMAX_APP_API_KEY=FA_MINIMAX_APP_API_KEY\n', ''),
          'FA_RUNTIME_SECRETS=(',
          '  FA_INTERNAL_AUTH_TOKEN',
          '  FA_OPENROUTER_APP_API_KEY',
          ')',
          '',
        ].join('\n'),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': [
          cloudInitWithNarrowSudoWrappers
            .replace('      FA_PROD_OPENROUTER_APP_API_KEY=FA_OPENROUTER_APP_API_KEY\n', '')
            .replace('      FA_PROD_MINIMAX_APP_API_KEY=FA_MINIMAX_APP_API_KEY\n', ''),
          'FA_RUNTIME_SECRETS=(',
          '  FA_INTERNAL_AUTH_TOKEN',
          '  FA_OPENROUTER_APP_API_KEY',
          ')',
          '',
        ].join('\n'),
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithProvisioningDnsToken
          .replace('    "FA_DEV_OPENROUTER_APP_API_KEY",\n', '')
          .replace('    "FA_PROD_OPENROUTER_APP_API_KEY",\n', '')
          .replace('    "FA_DEV_MINIMAX_APP_API_KEY",\n', '')
          .replace('    "FA_PROD_MINIMAX_APP_API_KEY",\n', ''),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/pull-local-env.mjs must read FA_DEV_OPENROUTER_APP_API_KEY into local FA_OPENROUTER_APP_API_KEY',
            'scripts/hetzner/load-secrets.sh must read FA_PROD_OPENROUTER_APP_API_KEY into runtime FA_OPENROUTER_APP_API_KEY',
            'scripts/hetzner/provision.sh fa-load-secrets wrapper must read FA_PROD_OPENROUTER_APP_API_KEY into runtime FA_OPENROUTER_APP_API_KEY',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl fa-load-secrets wrapper must read FA_PROD_OPENROUTER_APP_API_KEY into runtime FA_OPENROUTER_APP_API_KEY',
            'terraform/gcp-data-plane/main.tf must define FA_DEV_OPENROUTER_APP_API_KEY and FA_PROD_OPENROUTER_APP_API_KEY as runtime Secret Manager secrets',
            'scripts/pull-local-env.mjs must read FA_DEV_MINIMAX_APP_API_KEY into local FA_MINIMAX_APP_API_KEY',
            'scripts/hetzner/load-secrets.sh must read FA_PROD_MINIMAX_APP_API_KEY into runtime FA_MINIMAX_APP_API_KEY',
            'scripts/hetzner/provision.sh fa-load-secrets wrapper must read FA_PROD_MINIMAX_APP_API_KEY into runtime FA_MINIMAX_APP_API_KEY',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl fa-load-secrets wrapper must read FA_PROD_MINIMAX_APP_API_KEY into runtime FA_MINIMAX_APP_API_KEY',
            'terraform/gcp-data-plane/main.tf must define FA_DEV_MINIMAX_APP_API_KEY and FA_PROD_MINIMAX_APP_API_KEY as runtime Secret Manager secrets',
          ])
        );
      }
    );
  });

  it('rejects runtime Secret Manager access and ambient DNS-token provisioning credentials', () => {
    withStaticFixture(
      {
        'scripts/hetzner/install-nginx-and-cert.sh':
          installNginxAndCertWithoutRequiredProvisionerKey,
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithRuntimeProjectSecretAccess,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/install-nginx-and-cert.sh must require the provisioner service-account key before reading FA_CLOUDFLARE_DNS_API_TOKEN',
            'terraform/gcp-data-plane/main.tf must not grant Secret Manager access to fa-hetzner-runtime',
          ])
        );
      }
    );
  });

  it('allows Cloudflare DNS token only in certificate provisioning and Terraform provisioning secrets', () => {
    withStaticFixture(
      {
        '.env.prod.example': 'FA_INTERNAL_AUTH_TOKEN=replace-with-secret-manager-value\n',
        'scripts/hetzner/install-nginx-and-cert.sh':
          'FA_HETZNER_PROVISIONER_KEY_FILE="${FA_HETZNER_PROVISIONER_KEY_FILE:-/etc/fa/keys/provisioner-sa-key.json}"\n[[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1\nexport CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"\nCLOUDFLARE_DNS_API_TOKEN_SECRET="${CLOUDFLARE_DNS_API_TOKEN_SECRET:-FA_CLOUDFLARE_DNS_API_TOKEN}"\ngcloud secrets versions access latest --secret="${CLOUDFLARE_DNS_API_TOKEN_SECRET}"\n',
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithProvisioningDnsToken,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual([]);
      }
    );
  });

  it('rejects Terraform-managed service-account credentials and requires the expected service-account identities', () => {
    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithServiceAccountKey,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must not manage service-account private keys with google_service_account_key'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneMissingRuntimeServiceAccount,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must define service account fa-hetzner-runtime'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithExtraServiceAccount,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must not define unexpected service account fa-extra-runtime'
        );
      }
    );
  });

  it('rejects Terraform credential and service-account IAM bypasses in any GCP data-plane tf file', () => {
    withStaticFixture(
      {
        'terraform/gcp-data-plane/keys.tf': [
          'resource "google_service_account_key" "provisioner_key" {',
          '  service_account_id = google_service_account.hetzner_provisioner.name',
          '}',
          '',
          'resource "google_project_iam_member" "runtime_owner_extra" {',
          '  role    = "roles/owner"',
          '  member  = "serviceAccount:${google_service_account.hetzner_runtime.email}"',
          '}',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'terraform/gcp-data-plane must not manage service-account private keys with google_service_account_key',
            'terraform/gcp-data-plane must not grant roles/owner to fa-hetzner-runtime',
          ])
        );
      }
    );
  });

  it('rejects admin credential references in GitHub Actions and production runtime surfaces', () => {
    withStaticFixture(
      {
        '.github/workflows/deploy.yml': `${deployWorkflowWithProdMainAncestryCheck}\nFA_GCP_ADMIN_KEY_FILE: bad\n`,
        '.env.prod.example':
          'GOOGLE_APPLICATION_CREDENTIALS=/home/operator/.config/gcloud/fa-admin-key.json\n',
        'scripts/hetzner/load-secrets.sh':
          'FA_GCP_ADMIN_KEY_FILE=/home/operator/.config/gcloud/fa-admin-key.json\n',
        'scripts/hetzner/provision.sh': `${provisionWithNarrowSudoWrappers}\nfa-admin-key.json\n`,
        'ecosystem.config.prod.cjs': 'process.env.FA_GCP_ADMIN_KEY_FILE;\n',
        'docker/prod/Dockerfile': 'ENV GOOGLE_APPLICATION_CREDENTIALS=/keys/fa-admin-key.json\n',
        'apps/web/src/config.generated.ts': "export const bad = 'FA_GCP_ADMIN_KEY_FILE';\n",
        'ecosystem.generated.cjs': "module.exports = { key: 'fa-admin-key.json' };\n",
        'terraform/hetzner-prod/service-urls.auto.tfvars.json':
          '{"GOOGLE_APPLICATION_CREDENTIALS":"/keys/fa-admin-key.json"}\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            '.github/workflows/deploy.yml must not reference admin service-account credentials',
            '.env.prod.example must not reference admin service-account credentials',
            'scripts/hetzner/load-secrets.sh must not reference admin service-account credentials',
            'scripts/hetzner/provision.sh must not reference admin service-account credentials',
            'ecosystem.config.prod.cjs must not reference admin service-account credentials',
            'docker/prod/Dockerfile must not reference admin service-account credentials',
            'apps/web/src/config.generated.ts must not reference admin service-account credentials',
            'ecosystem.generated.cjs must not reference admin service-account credentials',
            'terraform/hetzner-prod/service-urls.auto.tfvars.json must not reference admin service-account credentials',
          ])
        );
      }
    );
  });

  it('rejects admin credential references in any GitHub Actions workflow', () => {
    withStaticFixture(
      {
        '.github/workflows/reusable.yaml': [
          'name: reusable',
          'jobs:',
          '  check:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - name: Bad admin key',
          '        env:',
          '          GOOGLE_APPLICATION_CREDENTIALS: /keys/fa-admin-key.json',
          '        run: echo bad',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          '.github/workflows/reusable.yaml must not reference admin service-account credentials'
        );
      }
    );
  });

  it('enforces runtime service-account Firestore access without Secret Manager or broad admin roles', () => {
    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithoutRuntimeFirestore,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must grant Firestore access to fa-hetzner-runtime'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithForbiddenRuntimeRoles,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'terraform/gcp-data-plane must not grant roles/owner to fa-hetzner-runtime',
            'terraform/gcp-data-plane must not grant roles/iam.serviceAccountKeyAdmin to fa-hetzner-runtime',
            'terraform/gcp-data-plane must not grant broad project admin role roles/resourcemanager.projectIamAdmin to fa-hetzner-runtime',
          ])
        );
      }
    );
  });

  it('enforces provisioner service-account Secret Manager scoping without Firestore or broad admin roles', () => {
    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithForbiddenProvisionerRoles,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'terraform/gcp-data-plane must not grant Firestore role roles/datastore.user to fa-hetzner-provisioner',
            'terraform/gcp-data-plane must not grant roles/editor to fa-hetzner-provisioner',
            'terraform/gcp-data-plane must not grant roles/iam.serviceAccountAdmin to fa-hetzner-provisioner',
          ])
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithProjectProvisionerSecretAccess,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must scope fa-hetzner-provisioner Secret Manager access to explicit runtime and provisioning secrets, not project-level IAM'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/unapproved-secret.tf': terraformGcpDataPlaneExtraSecretAccessor,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must not grant fa-hetzner-provisioner Secret Manager access outside explicit runtime and provisioning secret resources'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/wrong-backup-bucket.tf':
          terraformGcpDataPlaneWrongBackupBucketGrant,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must scope fa-hetzner-provisioner storage bucket IAM grants to google_storage_bucket.firestore_backups'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneBroadBackupBucketGrant,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must grant fa-hetzner-provisioner backup bucket access with roles/storage.objectAdmin only'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneMissingProvisioningSecretAccess,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'terraform/gcp-data-plane must grant fa-hetzner-provisioner Secret Manager access to explicit runtime and provisioning secret resources'
        );
      }
    );

    withStaticFixture(
      {
        'terraform/gcp-data-plane/main.tf': terraformGcpDataPlaneWithProvisioningDnsToken,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual([]);
      }
    );
  }, 10_000);

  it('rejects Secret Manager reads that allow ambient credentials in production scripts and wrappers', () => {
    withStaticFixture(
      {
        'scripts/hetzner/load-secrets.sh': loadSecretsWithAmbientSecretManagerRead,
        'scripts/hetzner/provision.sh': provisionWithNarrowSudoWrappers.replace(
          '[[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1\nexport CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"\n',
          ''
        ),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': cloudInitWithNarrowSudoWrappers.replace(
          '      [[ -r "${FA_HETZNER_PROVISIONER_KEY_FILE}" ]] || exit 1\n      export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${FA_HETZNER_PROVISIONER_KEY_FILE}"\n',
          ''
        ),
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/load-secrets.sh Secret Manager reads must require FA_HETZNER_PROVISIONER_KEY_FILE and export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE before each read',
            'scripts/hetzner/provision.sh Secret Manager reads must require FA_HETZNER_PROVISIONER_KEY_FILE and export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE before each read',
            'terraform/hetzner-prod/cloud-init.yaml.tftpl Secret Manager reads must require FA_HETZNER_PROVISIONER_KEY_FILE and export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE before each read',
          ])
        );
      }
    );

    withStaticFixture(
      {
        'scripts/hetzner/load-secrets.sh': loadSecretsWithReadBeforeCredentialExport,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/load-secrets.sh Secret Manager reads must require FA_HETZNER_PROVISIONER_KEY_FILE and export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE before each read'
        );
      }
    );

    withStaticFixture(
      {
        'scripts/hetzner/load-secrets.sh': loadSecretsWithCredentialResetBeforeSecondRead,
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/load-secrets.sh Secret Manager reads must require FA_HETZNER_PROVISIONER_KEY_FILE and export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE before each read'
        );
      }
    );
  });

  it('rejects non-read-only runtime key Docker mounts and missing credential matrix docs', () => {
    withStaticFixture(
      {
        'scripts/hetzner/reload-services-container.sh':
          'docker run --name fa-services -v "/etc/fa/keys/runtime-sa-key.json:/run/secrets/fa-runtime-sa-key.json" -p 127.0.0.1:3201:3201 fa-services:abc123\n',
        'docs/operations/fa-mvp-runbook.md': '# FA MVP Runbook\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/reload-services-container.sh must mount the runtime service-account key read-only',
            'docs/operations/fa-mvp-runbook.md must document the admin/provisioner/runtime credential matrix and operator checklist',
          ])
        );
      }
    );

    withStaticFixture(
      {
        'scripts/hetzner/reload-services-container.sh':
          'docker run --name fa-services -v "${FA_HETZNER_RUNTIME_KEY_FILE}:/run/secrets/fa-runtime-sa-key.json" -p 127.0.0.1:3201:3201 fa-services:abc123\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/hetzner/reload-services-container.sh must mount the runtime service-account key read-only'
        );
      }
    );
  });

  it('rejects deployment artifacts that use wrong product env prefixes or broad Docker ports', () => {
    withStaticFixture(
      {
        'scripts/hetzner/reload-services-container.sh':
          'docker run -p 3201:3201 --name fa-services fa-services:abc123\n',
        'scripts/deploy/deploy-dev.sh': `${foreignProductEnv}=prod echo bad\n`,
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            `Forbidden non-FA product env reference in scripts/deploy/deploy-dev.sh: ${foreignProductEnv}`,
            'scripts/hetzner/reload-services-container.sh must publish service ports on 127.0.0.1 only',
          ])
        );
      }
    );
  });

  it('rejects generic product env aliases in product-owned deployment scripts', () => {
    withStaticFixture(
      {
        'scripts/deploy/deploy-dev.sh': [
          '#!/usr/bin/env bash',
          'REPO_PATH="${REPO_PATH:-$HOME/deploy/fishing-assistant}"',
          'DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-scripts/deploy/deploy-dev.sh}"',
          'REMOTE_URL="${REMOTE_URL:-https://github.com/pbuchman/fishing-assistant.git}"',
          'SOURCE_REPO="${SOURCE_REPO:-}"',
          'echo "${REPO_PATH} ${DEPLOY_SCRIPT}"',
          'FA_PM2_HOME="${FA_PM2_HOME:-${HOME}/.pm2-fa}"',
          'PM2_HOME="${FA_PM2_HOME}" pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env',
          '',
        ].join('\n'),
        'scripts/hetzner/deploy-web.sh': [
          '#!/usr/bin/env bash',
          'REPO_DIR="${REPO_DIR:-/opt/fishing-assistant/current}"',
          'REPO_CLONE_PATH="${REPO_CLONE_PATH:-/opt/fishing-assistant/current}"',
          'ENV_FILE="${ENV_FILE:-/etc/fa/.env.prod}"',
          'WEB_RELEASES_DIR="${WEB_RELEASES_DIR:-/var/www/fa/releases}"',
          'WEB_PUBLISH_DIR="${WEB_PUBLISH_DIR:-/var/www/fa/current}"',
          'WEB_CURRENT="${WEB_CURRENT:-/var/www/fa/current}"',
          'echo "${REPO_DIR} ${REPO_CLONE_PATH} ${ENV_FILE} ${WEB_RELEASES_DIR} ${WEB_PUBLISH_DIR} ${WEB_CURRENT}"',
          '',
        ].join('\n'),
        'scripts/hetzner/load-secrets.sh': [
          '#!/usr/bin/env bash',
          'RUNTIME_SA_KEY_FILE="${RUNTIME_SA_KEY_FILE:-/run/secrets/fa-runtime-sa-key.json}"',
          'echo "${RUNTIME_SA_KEY_FILE}"',
          '',
        ].join('\n'),
        'scripts/hetzner/provision.sh': [
          '#!/usr/bin/env bash',
          'WEB_ROOT="${WEB_ROOT:-/var/www/fa}"',
          'SWAP_FILE="${SWAP_FILE:-/swapfile}"',
          'SWAP_SIZE="${SWAP_SIZE:-4G}"',
          'echo "${WEB_ROOT} ${SWAP_FILE} ${SWAP_SIZE}"',
          '',
        ].join('\n'),
        'scripts/observability/install-alloy.sh': [
          '#!/usr/bin/env bash',
          'DEPLOY_SHA="${DEPLOY_SHA:-unknown}"',
          'node scripts/observability/render-alloy-config.mjs --sha "${DEPLOY_SHA}"',
          '',
        ].join('\n'),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': [
          '#cloud-config',
          'write_files:',
          '  - path: /usr/local/sbin/fa-load-secrets',
          '    content: |',
          '      #!/usr/bin/env bash',
          '      RUNTIME_SA_KEY_FILE="/run/secrets/fa-runtime-sa-key.json"',
          '      echo "${RUNTIME_SA_KEY_FILE}"',
          '',
        ].join('\n'),
        '.github/workflows/deploy.yml': [
          'name: deploy',
          'jobs:',
          '  deploy:',
          '    steps:',
          '      - name: Deploy',
          '        env:',
          '          REPO_CLONE_PATH: /tmp/fa',
          '        run: echo "$REPO_CLONE_PATH"',
          '',
        ].join('\n'),
      },
      (root) => {
        const genericAliasErrors = validateStaticRepository(root)
          .filter((error) => error.startsWith('Forbidden generic product env alias in '))
          .sort();

        expect(genericAliasErrors).toEqual([
          'Forbidden generic product env alias in .github/workflows/deploy.yml: REPO_CLONE_PATH',
          'Forbidden generic product env alias in scripts/deploy/deploy-dev.sh: DEPLOY_SCRIPT, REMOTE_URL, REPO_PATH, SOURCE_REPO',
          'Forbidden generic product env alias in scripts/hetzner/deploy-web.sh: ENV_FILE, REPO_CLONE_PATH, REPO_DIR, WEB_CURRENT, WEB_PUBLISH_DIR, WEB_RELEASES_DIR',
          'Forbidden generic product env alias in scripts/hetzner/load-secrets.sh: RUNTIME_SA_KEY_FILE',
          'Forbidden generic product env alias in scripts/hetzner/provision.sh: SWAP_FILE, SWAP_SIZE, WEB_ROOT',
          'Forbidden generic product env alias in scripts/observability/install-alloy.sh: DEPLOY_SHA',
          'Forbidden generic product env alias in terraform/hetzner-prod/cloud-init.yaml.tftpl: RUNTIME_SA_KEY_FILE',
        ]);
      }
    );
  });

  it('allows FA product env contracts and lowercase shell locals in deployment scripts', () => {
    withStaticFixture(
      {
        'scripts/deploy/deploy-dev.sh': [
          '#!/usr/bin/env bash',
          'repo_path="${FA_DEV_REPO_PATH:-$HOME/deploy/fishing-assistant}"',
          'deploy_script="${FA_DEV_DEPLOY_SCRIPT:-scripts/deploy/deploy-dev.sh}"',
          'remote_url="${FA_DEV_REMOTE_URL:-https://github.com/pbuchman/fishing-assistant.git}"',
          'source_repo="${FA_DEV_SOURCE_REPO:-}"',
          'echo "${repo_path} ${deploy_script} ${remote_url} ${source_repo}"',
          'FA_PM2_HOME="${FA_PM2_HOME:-${HOME}/.pm2-fa}"',
          'PM2_HOME="${FA_PM2_HOME}" pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env',
          '',
        ].join('\n'),
        'scripts/hetzner/deploy-web.sh': [
          '#!/usr/bin/env bash',
          'repo_dir="$(pwd)"',
          'env_file="${FA_PROD_ENV_FILE:-/etc/fa/.env.prod}"',
          'web_releases_dir="${FA_HETZNER_WEB_RELEASES_DIR:-/var/www/fa/releases}"',
          'web_root="${FA_HETZNER_WEB_ROOT:-/var/www/fa/current}"',
          'echo "${repo_dir} ${env_file} ${web_releases_dir} ${web_root}"',
          '',
        ].join('\n'),
        'scripts/hetzner/load-secrets.sh': [
          '#!/usr/bin/env bash',
          'runtime_sa_key_file="${FA_HETZNER_RUNTIME_SA_KEY_FILE:-/run/secrets/fa-runtime-sa-key.json}"',
          'temp_env_file="$(mktemp)"',
          'echo "${runtime_sa_key_file} ${temp_env_file}"',
          '',
        ].join('\n'),
        'scripts/observability/install-alloy.sh': [
          '#!/usr/bin/env bash',
          'deploy_sha="${FA_RELEASE_SHA:-unknown}"',
          'node scripts/observability/render-alloy-config.mjs --sha "${deploy_sha}"',
          '',
        ].join('\n'),
        'terraform/hetzner-prod/cloud-init.yaml.tftpl': [
          '#cloud-config',
          'write_files:',
          '  - path: /usr/local/sbin/fa-load-secrets',
          '    content: |',
          '      #!/usr/bin/env bash',
          '      runtime_sa_key_file="/run/secrets/fa-runtime-sa-key.json"',
          '      echo "${runtime_sa_key_file}"',
          '',
        ].join('\n'),
        '.github/workflows/deploy.yml': [
          'name: deploy',
          'jobs:',
          '  deploy:',
          '    steps:',
          '      - name: Deploy',
          '        env:',
          '          FA_HETZNER_RELEASES_DIR: /opt/fishing-assistant/releases',
          '        run: echo "$FA_HETZNER_RELEASES_DIR"',
          '',
        ].join('\n'),
      },
      (root) => {
        const forbiddenEnvErrors = validateStaticRepository(root).filter(
          (error) =>
            error.startsWith('Forbidden generic product env alias in ') ||
            error.startsWith('Forbidden non-FA product env reference in ')
        );

        expect(forbiddenEnvErrors).toEqual([]);
      }
    );
  });

  it('requires DEV deployment artifacts to use an isolated FA PM2 home', () => {
    withStaticFixture(
      {
        'scripts/deploy/deploy-dev.sh':
          '#!/usr/bin/env bash\npnpm exec pm2 startOrReload ecosystem.config.cjs\n',
        'scripts/dev-host/webhook-handler.service': '[Service]\n',
        'scripts/dev-host/fa-pm2.service':
          '[Service]\nEnvironment=PM2_HOME=/tmp/shared-pm2\nExecReload=pm2 reload all\n',
      },
      (root) => {
        expect(validateStaticRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/deploy/deploy-dev.sh must run DEV PM2 with isolated FA_PM2_HOME',
            'scripts/dev-host/webhook-handler.service must export portable FA PM2 and Node wiring',
            'scripts/dev-host/fa-pm2.service must isolate FA PM2 without host-wide PM2 commands',
          ])
        );
      }
    );
  });

  it('rejects webhook systemd units that put variables in the executable position', () => {
    withStaticFixture(
      {
        'scripts/dev-host/webhook-handler.service': [
          '[Service]',
          'Environment=FA_NODE_BIN=/usr/bin/node',
          'Environment=FA_DEV_REPO_PATH=%h/deploy/fishing-assistant',
          'Environment=FA_DEV_DEPLOY_SCRIPT=%h/deploy/fishing-assistant/scripts/deploy/deploy-dev.sh',
          'Environment=FA_PM2_HOME=%h/.pm2-fa',
          'Environment=PM2_HOME=%h/.pm2-fa',
          'ExecStart=${FA_NODE_BIN} %h/tools/fa-webhook-handler/webhook-handler.mjs',
          '',
        ].join('\n'),
      },
      (root) => {
        expect(validateStaticRepository(root)).toContain(
          'scripts/dev-host/webhook-handler.service must export portable FA PM2 and Node wiring'
        );
      }
    );
  });
});

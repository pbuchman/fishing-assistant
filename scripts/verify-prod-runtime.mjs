#!/usr/bin/env node
// @ts-check

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadServiceManifest } from './generate-service-wiring.mjs';

/** @typedef {{ name: string, cwd: string, env?: Record<string, string> }} Pm2App */
/** @typedef {{ apps: Pm2App[] }} Pm2Config */
/** @typedef {{ name: string, envSuffix: string, apiPath: string, proxyTarget: string, serviceUrl: string }} ProdRuntimeManifestEntry */
/** @typedef {{ services: ProdRuntimeManifestEntry[] }} ProdRuntimeManifest */

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const require = createRequire(import.meta.url);

const expectedPorts = new Map([
  ['fa-llm-usage-service', '3203'],
  ['fa-knowledge-service', '3202'],
  ['fa-chat-service', '3201'],
  ['fa-user-service', '3204'],
]);
const sharedContentBucket = 'replace-with-shared-content-bucket';
const requiredProdObservabilityArtifacts = [
  'scripts/observability/fa-alloy.service',
  'scripts/observability/install-alloy.sh',
  'scripts/observability/render-alloy-config.mjs',
  'scripts/observability/templates/fa-prod.alloy.tmpl',
  'scripts/observability/alert-router.mjs',
  'scripts/hetzner/load-observability-env.sh',
  'scripts/hetzner/install-observability.sh',
  'scripts/hetzner/fa-alert-router.service',
];

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`Production runtime verification failed: ${message}\n`);
  process.exit(1);
}

/**
 * @param {unknown} value
 * @returns {asserts value is Pm2Config}
 */
function assertPm2Config(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(/** @type {{ apps?: unknown }} */ (value).apps)
  ) {
    fail('ecosystem.config.prod.cjs did not export an apps array');
  }
}

/**
 * @returns {string}
 */
function createFixtureEnvFile() {
  const dir = mkdtempSync(resolve(tmpdir(), 'fa-prod-runtime-'));
  const filePath = resolve(dir, '.env.prod.fixture');
  writeFileSync(
    filePath,
    [
      'FA_ENVIRONMENT=prod',
      'FA_GCP_PROJECT_ID=example-fa-project',
      'FA_GCP_REGION=europe-central2',
      'FA_DATA_PLANE=gcp',
      'FA_BIND_HOST=0.0.0.0',
      'FA_WEB_APP_URL=https://fishing-assistant.online',
      'FA_PUBLIC_ORIGIN=https://fishing-assistant.online',
      'FA_CHAT_SERVICE_URL=/api/chat',
      'FA_KNOWLEDGE_SERVICE_URL=/api/knowledge',
      'FA_LLM_USAGE_SERVICE_URL=/api/llm-usage',
      'FA_USER_SERVICE_URL=/api/users',
      'FA_CHAT_SERVICE_INTERNAL_URL=http://127.0.0.1:3201',
      'FA_KNOWLEDGE_SERVICE_INTERNAL_URL=http://127.0.0.1:3202',
      'FA_LLM_USAGE_SERVICE_INTERNAL_URL=http://127.0.0.1:3203',
      'FA_USER_SERVICE_INTERNAL_URL=http://127.0.0.1:3204',
      'FA_INTERNAL_AUTH_TOKEN=fixture-token',
      'FA_INTERNAL_AUTH_TOKEN_PREVIOUS=',
      'FA_AUTH0_DOMAIN=auth.example.com',
      'FA_AUTH0_CLIENT_ID=auth0-client-id',
      'FA_AUTH0_AUDIENCE=https://api.fishing-assistant.online',
      'FA_AUTH0_ISSUER=https://auth.example.com/',
      'FA_AUTH0_JWKS_URI=https://auth.example.com/.well-known/jwks.json',
      'FA_BOOTSTRAP_ADMIN_EMAILS=admin@example.com',
      'FA_SIGNUP_ALLOWED_EMAIL_PATTERN=^[^@\\s]+@example\\.com$',
      'FA_EMBEDDING_PROVIDER=openrouter',
      'FA_EMBEDDING_MODEL=qwen/qwen3-embedding-8b',
      'FA_EMBEDDING_DIMENSIONS=2048',
      'FA_OPENROUTER_APP_API_KEY=fixture-openrouter-key',
      'FA_MINIMAX_APP_API_KEY=fixture-minimax-key',
      'FA_OPENAI_APP_API_KEY=',
      'FA_GEMINI_APP_API_KEY=',
      '',
    ].join('\n')
  );
  return filePath;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} serviceName
 * @returns {string}
 */
function upstreamName(serviceName) {
  return `fa_${serviceName.replaceAll('-', '_')}`;
}

/**
 * @param {ProdRuntimeManifestEntry} service
 * @returns {string}
 */
function servicePort(service) {
  try {
    const port = new URL(service.serviceUrl).port;
    return port;
  } catch {
    return '';
  }
}

/**
 * @param {string} source
 * @param {string} pattern
 * @returns {boolean}
 */
function hasRegex(source, pattern) {
  return new RegExp(pattern, 'm').test(source);
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @returns {string | undefined}
 */
function readOptionalRepositoryFile(root, relativePath) {
  const filePath = resolve(root, relativePath);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined;
}

/**
 * @param {string} source
 * @param {string} locationPath
 * @returns {string}
 */
function locationBlock(source, locationPath) {
  const escapedLocationPath = escapeRegExp(locationPath);
  const match = new RegExp(`location\\s+${escapedLocationPath}\\s*\\{`, 'm').exec(source);
  if (match === null) {
    return '';
  }

  let depth = 1;
  let cursor = match.index + match[0].length;
  const blockStart = cursor;

  while (cursor < source.length && depth > 0) {
    const character = source[cursor];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
    cursor += 1;
  }

  return depth === 0 ? source.slice(blockStart, cursor - 1) : '';
}

/**
 * @param {string} source
 * @param {ProdRuntimeManifest} manifest
 * @returns {string[]}
 */
function validateNginxRouting(source, manifest) {
  /** @type {string[]} */
  const errors = [];

  if (!source.includes('server_name fishing-assistant.online')) {
    errors.push('nginx config must serve fishing-assistant.online');
  }

  if (!/location\s*=\s*\/healthz\b/.test(source)) {
    errors.push('nginx config must expose /healthz');
  }

  const firstLocationIndex = source.search(/\blocation\s+/);
  const serverPreamble = firstLocationIndex === -1 ? source : source.slice(0, firstLocationIndex);
  if (/auth_basic\s+"Fishing Assistant";/.test(serverPreamble)) {
    errors.push('nginx config must not enable Basic Auth at server scope');
  }

  const homeLocation = locationBlock(source, '= /');
  const indexLocation = locationBlock(source, '= /index.html');
  const homepageLocations = [homeLocation, indexLocation];
  if (
    homepageLocations.some(
      (block) =>
        !/auth_basic\s+"Fishing Assistant";/.test(block) ||
        !/auth_basic_user_file\s+\/etc\/nginx\/fa-site-basic-auth\.htpasswd;/.test(block)
    )
  ) {
    errors.push('nginx config must protect / and /index.html with site Basic Auth');
  }

  const appLocation = locationBlock(source, '= /app');
  const appPrefixLocation = locationBlock(source, '/app/');
  if (!/auth_basic\s+off;/.test(appLocation) || !/auth_basic\s+off;/.test(appPrefixLocation)) {
    errors.push('nginx config must explicitly exempt /app from Basic Auth');
  }

  const internalBlockIndex = source.search(/location\s+~\s+\^\/api\/\[a-z0-9-\]\+\/internal/);
  if (internalBlockIndex === -1) {
    errors.push('nginx config must block public /api/*/internal/* routes before service proxies');
  }

  if (/proxy_set_header\s+X-Internal-Auth\b/.test(source)) {
    errors.push('nginx config must not inject X-Internal-Auth into public API requests');
  }

  const alertRoute = locationBlock(source, '= /alerts/grafana');
  if (!/proxy_pass\s+http:\/\/127\.0\.0\.1:9002;/.test(alertRoute)) {
    errors.push(
      'nginx config must proxy only /alerts/grafana to fa-alert-router on 127.0.0.1:9002'
    );
  }

  if (/location\s+(?:\^~\s+|~\s+)?(?:\^)?\/alerts\/(?!grafana)/.test(source)) {
    errors.push('nginx config must not expose broad /alerts/* routes');
  }

  if (/proxy_pass_request_headers\s+off;/.test(alertRoute)) {
    errors.push('nginx config must preserve request headers for fa-alert-router');
  }

  if (/proxy_set_header\s+X-FA-Alert-Secret\s+"";/.test(source)) {
    errors.push('nginx config must preserve X-FA-Alert-Secret for fa-alert-router');
  }

  const shareLocation = locationBlock(source, '/share/');
  if (!/location\s*=\s*\/share\s*\{\s*return\s+301\s+\/share\/;\s*\}/.test(source)) {
    errors.push('nginx config must redirect /share to /share/');
  }

  if (
    !new RegExp(
      `proxy_pass\\s+https://storage\\.googleapis\\.com/${sharedContentBucket}/share/;`
    ).test(shareLocation)
  ) {
    errors.push('nginx config must route /share/ to the shared-content GCS bucket');
  }

  if (!/proxy_set_header\s+Host\s+storage\.googleapis\.com;/.test(shareLocation)) {
    errors.push('nginx config must set storage.googleapis.com Host header for /share/');
  }

  if (!/proxy_set_header\s+Authorization\s+"";/.test(shareLocation)) {
    errors.push('nginx config must clear Authorization header for /share/');
  }

  if (!/proxy_ssl_server_name\s+on;/.test(shareLocation)) {
    errors.push('nginx config must enable TLS SNI for /share/ upstream');
  }

  for (const service of manifest.services) {
    const upstream = upstreamName(service.name);
    const port = servicePort(service);
    if (port.length === 0) {
      errors.push(`service manifest entry ${service.name} must have a port in serviceUrl`);
      continue;
    }

    const escapedApiPath = escapeRegExp(service.apiPath);
    const escapedUpstream = escapeRegExp(upstream);
    const firstProxyLocationIndex = source.search(
      new RegExp(`location\\s*(?:=\\s*)?${escapedApiPath}(?:/|\\s)`)
    );
    if (internalBlockIndex > firstProxyLocationIndex && firstProxyLocationIndex !== -1) {
      if (
        !errors.includes(
          'nginx config must block public /api/*/internal/* routes before service proxies'
        )
      ) {
        errors.push(
          'nginx config must block public /api/*/internal/* routes before service proxies'
        );
      }
    }

    if (
      !hasRegex(
        source,
        `upstream\\s+${escapedUpstream}\\s*\\{\\s*server\\s+127\\.0\\.0\\.1:${escapeRegExp(port)}\\b`
      )
    ) {
      errors.push(`nginx config must define upstream ${upstream} on 127.0.0.1:${port}`);
    }

    if (
      !hasRegex(
        source,
        `location\\s*=\\s*${escapedApiPath}\\s*\\{\\s*proxy_pass\\s+http://${escapedUpstream}/;\\s*\\}`
      )
    ) {
      errors.push(
        `nginx config must route ${service.apiPath} to upstream ${upstream} with prefix stripping`
      );
    }

    if (
      !hasRegex(
        source,
        `location\\s+${escapedApiPath}/\\s*\\{\\s*proxy_pass\\s+http://${escapedUpstream}/;\\s*\\}`
      )
    ) {
      errors.push(
        `nginx config must route ${service.apiPath}/ to upstream ${upstream} with prefix stripping`
      );
    }
  }

  return errors;
}

/**
 * @param {string} dockerfileSource
 * @param {string} reloadScriptSource
 * @param {ProdRuntimeManifest} manifest
 * @returns {string[]}
 */
function validateDockerRuntime(dockerfileSource, reloadScriptSource, manifest) {
  /** @type {string[]} */
  const errors = [];

  if (
    !dockerfileSource.includes('pm2-runtime') ||
    !dockerfileSource.includes('ecosystem.config.prod.cjs')
  ) {
    errors.push(
      'docker/prod/Dockerfile must start production services with pm2-runtime and ecosystem.config.prod.cjs'
    );
  }

  if (!dockerfileSource.includes('pnpm run build:services')) {
    errors.push('docker/prod/Dockerfile must build production service bundles');
  }

  if (
    !dockerfileSource.includes('/app/apps/${service}/dist') ||
    !dockerfileSource.includes('npm install --omit=dev')
  ) {
    errors.push(
      'docker/prod/Dockerfile must install generated dist runtime dependencies for backend services'
    );
  }

  if (!reloadScriptSource.includes('--name fa-services')) {
    errors.push('scripts/hetzner/reload-services-container.sh must manage fa-services');
  }

  if (
    !reloadScriptSource.includes('--env-file') ||
    !reloadScriptSource.includes('/etc/fa/.env.prod')
  ) {
    errors.push('scripts/hetzner/reload-services-container.sh must load /etc/fa/.env.prod');
  }

  if (!reloadScriptSource.includes('-e FA_RELEASE_SHA="${deploy_sha}"')) {
    errors.push(
      'scripts/hetzner/reload-services-container.sh must pass FA_RELEASE_SHA to services'
    );
  }

  if (!reloadScriptSource.includes('/run/secrets/fa-runtime-sa-key.json:ro')) {
    errors.push(
      'scripts/hetzner/reload-services-container.sh must mount the runtime service account key read-only'
    );
  }

  if (!/fa-services:\$\{?[A-Z_]*SHA|fa-services:[A-Za-z0-9_$/{.-]+/.test(reloadScriptSource)) {
    errors.push('scripts/hetzner/reload-services-container.sh must run a fa-services:<sha> image');
  }

  for (const service of manifest.services) {
    const port = servicePort(service);
    if (port.length === 0) {
      errors.push(`service manifest entry ${service.name} must have a port in serviceUrl`);
      continue;
    }

    const expectedPublish = `127.0.0.1:${port}:${port}`;
    if (!reloadScriptSource.includes(expectedPublish)) {
      errors.push(
        `scripts/hetzner/reload-services-container.sh must publish ${service.name} on ${expectedPublish}`
      );
    }
  }

  if (/(^|\s)-p\s+(?!127\.0\.0\.1:)\d{2,5}:\d{2,5}/.test(reloadScriptSource)) {
    errors.push(
      'scripts/hetzner/reload-services-container.sh must publish service ports on 127.0.0.1 only'
    );
  }

  return errors;
}

/**
 * @param {string} deployScriptSource
 * @param {ProdRuntimeManifest} manifest
 * @returns {string[]}
 */
function validateGithubActionsDeployRuntime(deployScriptSource, manifest) {
  /** @type {string[]} */
  const errors = [];

  if (
    !deployScriptSource.includes('verify_service_health()') ||
    !deployScriptSource.includes('verify_local_origin_health()') ||
    !deployScriptSource.includes('verify_https_edge_health()')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must separate backend service, local origin, and HTTPS edge health checks'
    );
  }

  if (
    !deployScriptSource.includes('--bootstrap-origin-http-only') ||
    !deployScriptSource.includes('deploy_bootstrap_origin_http_only')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must support --bootstrap-origin-http-only for first-origin HTTP bootstrap'
    );
  }

  if (
    !/(^|\n)\s*deploy_bootstrap_origin_http_only=false(\n|$)/.test(deployScriptSource) ||
    /deploy_bootstrap_origin_http_only="\$\{FA_DEPLOY_BOOTSTRAP_ORIGIN_HTTP_ONLY:-false\}"/.test(
      deployScriptSource
    )
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must initialize deploy_bootstrap_origin_http_only=false and set it only from --bootstrap-origin-http-only'
    );
  }

  if (
    /if\s+\[\[\s+"\\?\$\{(?:DEPLOY_NGINX|deploy_nginx)\}"\s+==\s+"true"\s+\]\];\s+then[\s\S]{0,250}verify_https_edge_health/.test(
      deployScriptSource
    ) ||
    !deployScriptSource.includes('verify_https_edge_health')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must run HTTPS edge health checks by default unless --bootstrap-origin-http-only is set'
    );
  }

  if (
    !deployScriptSource.includes('/usr/local/sbin/fa-load-observability-env') ||
    !deployScriptSource.includes('/usr/local/sbin/fa-install-observability') ||
    !deployScriptSource.includes('--with-alert-router')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must load and install production Grafana observability through sudo wrappers'
    );
  }

  if (
    !deployScriptSource.includes('FA_AUTH0_DOMAIN="${FA_AUTH0_DOMAIN:-}"') ||
    !deployScriptSource.includes('FA_AUTH0_CLIENT_ID="${FA_AUTH0_CLIENT_ID:-}"') ||
    !deployScriptSource.includes('FA_AUTH0_AUDIENCE="${FA_AUTH0_AUDIENCE:-}"') ||
    !deployScriptSource.includes('FA_AUTH0_DOMAIN is required') ||
    !deployScriptSource.includes('FA_AUTH0_CLIENT_ID is required') ||
    !deployScriptSource.includes('FA_AUTH0_AUDIENCE is required') ||
    !deployScriptSource.includes('--auth0-domain') ||
    !deployScriptSource.includes('--auth0-client-id') ||
    !deployScriptSource.includes('--auth0-audience')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must pass public Auth0 runtime config to fa-load-secrets as explicit sudo wrapper arguments'
    );
  }

  if (
    !deployScriptSource.includes('verify_local_origin_homepage_basic_auth') ||
    !deployScriptSource.includes('verify_https_edge_homepage_basic_auth') ||
    !deployScriptSource.includes('assert_remote_https_origin_http_status / 401') ||
    !deployScriptSource.includes('assert_remote_https_origin_http_status /index.html 401') ||
    !deployScriptSource.includes(
      'assert_remote_https_origin_http_200 / "${site_basic_auth_header}"'
    ) ||
    !deployScriptSource.includes(
      'assert_remote_https_origin_http_200 /index.html "${site_basic_auth_header}"'
    ) ||
    !deployScriptSource.includes('assert_https_edge_http_status / 401') ||
    !deployScriptSource.includes('assert_https_edge_http_status /index.html 401') ||
    !deployScriptSource.includes('assert_https_edge_http_200 / "${site_basic_auth_header}"') ||
    !deployScriptSource.includes(
      'assert_https_edge_http_200 /index.html "${site_basic_auth_header}"'
    )
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must verify homepage Basic Auth on local-origin and HTTPS edge routes'
    );
  }

  const loadSecretsIndex = deployScriptSource.indexOf('/usr/local/sbin/fa-load-secrets');
  const dataBaselineIndex = deployScriptSource.indexOf('pnpm run verify:data-baseline');
  if (
    dataBaselineIndex === -1 ||
    (loadSecretsIndex !== -1 && dataBaselineIndex < loadSecretsIndex) ||
    !deployScriptSource.includes('/etc/fa/.env.prod') ||
    !deployScriptSource.includes('GOOGLE_APPLICATION_CREDENTIALS=/etc/fa/keys/runtime-sa-key.json')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must run live runtime data baseline verification with the production runtime service account after loading secrets'
    );
  }

  if (
    deployScriptSource.includes('FA_HETZNER_PROVISIONER_SERVICE_ACCOUNT_KEY') ||
    deployScriptSource.includes('FA_HETZNER_RUNTIME_SERVICE_ACCOUNT_KEY') ||
    deployScriptSource.includes('install_service_account_keys')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must not receive or install long-lived cloud service-account keys from GitHub Actions'
    );
  }

  if (
    !deployScriptSource.includes('assert_remote_http_200()') ||
    !deployScriptSource.includes('--write-out') ||
    !deployScriptSource.includes('%{http_code}') ||
    !deployScriptSource.includes('--output /dev/null') ||
    !deployScriptSource.includes('assert_remote_https_origin_http_200()') ||
    !deployScriptSource.includes(':443:127.0.0.1') ||
    !deployScriptSource.includes('https://${FA_PROD_DOMAIN}${path}') ||
    !deployScriptSource.includes('${status}') ||
    !deployScriptSource.includes('[[') ||
    !deployScriptSource.includes('200')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must assert HTTP 200 for local nginx origin health checks'
    );
  }

  if (
    !deployScriptSource.includes('assert_https_edge_http_200()') ||
    !deployScriptSource.includes('--write-out') ||
    !deployScriptSource.includes('%{http_code}') ||
    !deployScriptSource.includes('--output /dev/null') ||
    !deployScriptSource.includes('--resolve') ||
    !deployScriptSource.includes('https://${FA_PROD_DOMAIN}${path}') ||
    !deployScriptSource.includes('${status}') ||
    !deployScriptSource.includes('[[') ||
    !deployScriptSource.includes('200')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must assert HTTP 200 for HTTPS edge health checks'
    );
  }

  const verifiesAlloy =
    deployScriptSource.includes('systemctl is-active --quiet fa-alloy') ||
    deployScriptSource.includes('wait_for_remote_systemd_active fa-alloy');
  const verifiesAlertRouter =
    deployScriptSource.includes('systemctl is-active --quiet fa-alert-router') ||
    deployScriptSource.includes('wait_for_remote_systemd_active fa-alert-router');

  if (
    !verifiesAlloy ||
    !verifiesAlertRouter ||
    !deployScriptSource.includes('http://127.0.0.1:9002/health')
  ) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must verify fa-alloy and fa-alert-router after deploy'
    );
  }

  if (!deployScriptSource.includes('http://127.0.0.1/healthz')) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must verify bootstrap HTTP local nginx origin /healthz'
    );
  }

  if (!deployScriptSource.includes('assert_remote_https_origin_http_200 /healthz')) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must verify normal HTTPS local nginx origin /healthz'
    );
  }

  if (!deployScriptSource.includes('assert_https_edge_http_200 /healthz')) {
    errors.push(
      'scripts/hetzner/github-actions-deploy.sh must verify HTTPS edge /healthz by default'
    );
  }

  for (const path of manifest.services.map((service) => `${service.apiPath}/health`)) {
    if (!deployScriptSource.includes(`assert_remote_http_200 http://127.0.0.1${path}`)) {
      errors.push(
        `scripts/hetzner/github-actions-deploy.sh must verify bootstrap HTTP local nginx origin ${path}`
      );
    }

    if (!deployScriptSource.includes(`assert_remote_https_origin_http_200 ${path}`)) {
      errors.push(
        `scripts/hetzner/github-actions-deploy.sh must verify normal HTTPS local nginx origin ${path}`
      );
    }

    if (!deployScriptSource.includes(`assert_https_edge_http_200 ${path}`)) {
      errors.push(
        `scripts/hetzner/github-actions-deploy.sh must verify HTTPS edge ${path} by default`
      );
    }
  }

  for (const service of manifest.services) {
    const port = servicePort(service);
    if (port.length === 0) {
      errors.push(`service manifest entry ${service.name} must have a port in serviceUrl`);
      continue;
    }

    if (!deployScriptSource.includes(`http://127.0.0.1:${port}/health`)) {
      errors.push(
        `scripts/hetzner/github-actions-deploy.sh must verify ${service.name} service health on 127.0.0.1:${port}`
      );
    }
  }

  return errors;
}

/**
 * @param {string} deployScriptSource
 * @returns {string[]}
 */
function validateNginxDeployRuntime(deployScriptSource) {
  /** @type {string[]} */
  const errors = [];

  if (
    !deployScriptSource.includes('--origin-http-only') ||
    !deployScriptSource.includes('fishing-assistant.origin-http.conf')
  ) {
    errors.push(
      'scripts/hetzner/deploy-nginx.sh must support explicit origin HTTP-only nginx deployment before Cloudflare TLS is ready'
    );
  }

  if (!deployScriptSource.includes('nginx -t')) {
    errors.push('scripts/hetzner/deploy-nginx.sh must validate nginx config before reload');
  }

  if (!deployScriptSource.includes('rm -f /etc/nginx/sites-enabled/default')) {
    errors.push('scripts/hetzner/deploy-nginx.sh must remove the default nginx site');
  }

  if (
    !deployScriptSource.includes('/etc/nginx/fa-site-basic-auth.htpasswd') ||
    !deployScriptSource.includes('.fa/site-basic-auth.htpasswd') ||
    !deployScriptSource.includes('-g www-data')
  ) {
    errors.push(
      'scripts/hetzner/deploy-nginx.sh must install the release Basic Auth file to /etc/nginx/fa-site-basic-auth.htpasswd for nginx worker access'
    );
  }

  return errors;
}

/**
 * @param {Record<string, string | undefined>} sources
 * @returns {string[]}
 */
function validateProdObservabilityRuntime(sources) {
  /** @type {string[]} */
  const errors = [];

  for (const relativePath of requiredProdObservabilityArtifacts) {
    if (sources[relativePath] === undefined) {
      errors.push(`missing production observability runtime artifact: ${relativePath}`);
    }
  }

  const alloyService = sources['scripts/observability/fa-alloy.service'];
  if (alloyService !== undefined) {
    const alloyExecStart = /^ExecStart=(?<command>[^\n]+)$/m.exec(alloyService)?.groups?.[
      'command'
    ];
    const alloyExecParts = alloyExecStart?.trim().split(/\s+/) ?? [];

    if (
      !alloyService.includes('EnvironmentFile=-/etc/fa/observability.env') ||
      alloyExecParts[0] !== '/usr/bin/alloy' ||
      alloyExecParts[1] !== 'run' ||
      !alloyExecParts.includes('/etc/fa/alloy/fa.alloy') ||
      !alloyExecParts.includes('--server.http.listen-addr=127.0.0.1:12346')
    ) {
      errors.push(
        'scripts/observability/fa-alloy.service must load /etc/fa/observability.env and run /etc/fa/alloy/fa.alloy on the dedicated FA Alloy HTTP port'
      );
    }
  }

  const prodAlloyTemplate = sources['scripts/observability/templates/fa-prod.alloy.tmpl'];
  if (prodAlloyTemplate !== undefined) {
    if (
      !/discovery\.docker\s+"fa_services"\s*\{[\s\S]*?host\s*=\s*"unix:\/\/\/var\/run\/docker\.sock"/.test(
        prodAlloyTemplate
      ) ||
      !/discovery\.relabel\s+"fa_services"\s*\{[\s\S]*?targets\s*=\s*discovery\.docker\.fa_services\.targets/.test(
        prodAlloyTemplate
      ) ||
      !/source_labels\s*=\s*\[\s*"__meta_docker_container_name"\s*\]/.test(prodAlloyTemplate) ||
      !/regex\s*=\s*"\/fa-services"/.test(prodAlloyTemplate) ||
      !/action\s*=\s*"keep"/.test(prodAlloyTemplate) ||
      !/loki\.source\.docker\s+"fa_services"\s*\{[\s\S]*?targets\s*=\s*discovery\.relabel\.fa_services\.output/.test(
        prodAlloyTemplate
      )
    ) {
      errors.push(
        'scripts/observability/templates/fa-prod.alloy.tmpl must collect Docker logs from the fa-services container'
      );
    }

    if (!prodAlloyTemplate.includes('/var/log/nginx/*.log')) {
      errors.push(
        'scripts/observability/templates/fa-prod.alloy.tmpl must collect nginx logs from /var/log/nginx/*.log'
      );
    }

    if (!prodAlloyTemplate.includes('_SYSTEMD_UNIT=fa-alert-router.service')) {
      errors.push(
        'scripts/observability/templates/fa-prod.alloy.tmpl must collect fa-alert-router journald logs'
      );
    }
  }

  const prodInstall = sources['scripts/hetzner/install-observability.sh'];
  if (
    prodInstall !== undefined &&
    (!prodInstall.includes('render-alloy-config.mjs') ||
      !prodInstall.includes('--environment prod') ||
      !prodInstall.includes('/etc/fa/alloy/fa.alloy') ||
      !prodInstall.includes('/etc/systemd/system/fa-alloy.service') ||
      !prodInstall.includes('/etc/systemd/system/fa-alert-router.service') ||
      !prodInstall.includes('fa-alert-router'))
  ) {
    errors.push(
      'scripts/hetzner/install-observability.sh must render prod Alloy config and install fa-alloy plus fa-alert-router systemd units'
    );
  }

  const prodEnvLoader = sources['scripts/hetzner/load-observability-env.sh'];
  if (
    prodEnvLoader !== undefined &&
    (!prodEnvLoader.includes('/etc/fa/observability.env') ||
      !prodEnvLoader.includes('FA_GRAFANA_LOKI_URL') ||
      !prodEnvLoader.includes('FA_GRAFANA_LOKI_USERNAME') ||
      !prodEnvLoader.includes('FA_GRAFANA_LOKI_TOKEN') ||
      !prodEnvLoader.includes('FA_ALERT_ROUTER_WEBHOOK_SECRET') ||
      !prodEnvLoader.includes('FA_ALERT_ROUTER_GITHUB_TOKEN') ||
      !prodEnvLoader.includes('FA_GRAFANA_INSTANCE_URL') ||
      !prodEnvLoader.includes('FA_GRAFANA_LOKI_DATASOURCE_UID') ||
      !prodEnvLoader.includes('FA_ALERT_ROUTER_WEBHOOK_URL'))
  ) {
    errors.push(
      'scripts/hetzner/load-observability-env.sh must write /etc/fa/observability.env from FA Grafana and alert-router values'
    );
  }

  const alertRouterService = sources['scripts/hetzner/fa-alert-router.service'];
  if (
    alertRouterService !== undefined &&
    (!alertRouterService.includes('Environment=FA_ALERT_ROUTER_BIND_HOST=127.0.0.1') ||
      !alertRouterService.includes('Environment=PORT=9002') ||
      !alertRouterService.includes('EnvironmentFile=-/etc/fa/observability.env') ||
      !alertRouterService.includes('/usr/bin/node') ||
      !alertRouterService.includes('scripts/observability/alert-router.mjs'))
  ) {
    errors.push(
      'scripts/hetzner/fa-alert-router.service must run fa-alert-router on 127.0.0.1:9002 with /etc/fa/observability.env'
    );
  }

  return errors;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateProdRuntimeRepository(root = repoRoot) {
  /** @type {string[]} */
  const errors = [];

  process.env['FA_PROD_ENV_FILE'] = createFixtureEnvFile();

  const ecosystemPath = resolve(root, 'ecosystem.config.prod.cjs');
  delete require.cache[ecosystemPath];
  const ecosystem = require(ecosystemPath);
  assertPm2Config(ecosystem);

  const apps = ecosystem.apps;
  const appNames = apps.map((app) => app.name).sort();
  const expectedNames = [...expectedPorts.keys()].sort();

  if (JSON.stringify(appNames) !== JSON.stringify(expectedNames)) {
    errors.push(`expected service apps ${expectedNames.join(', ')}, found ${appNames.join(', ')}`);
  }

  for (const app of apps) {
    const expectedPort = expectedPorts.get(app.name);
    if (expectedPort === undefined) {
      errors.push(`unexpected PM2 app: ${app.name}`);
      continue;
    }

    if (app.env?.['PORT'] !== expectedPort) {
      errors.push(
        `${app.name} expected PORT=${expectedPort}, found ${app.env?.['PORT'] ?? '<missing>'}`
      );
    }

    if (
      app.cwd === './apps/web' ||
      app.name === 'web' ||
      app.name === 'fa-web' ||
      app.name === '@fa/web'
    ) {
      errors.push('production PM2 config must not include the web app');
    }
  }

  for (const relativePath of [
    'apps/web/src/config.generated.ts',
    'ecosystem.generated.cjs',
    'terraform/hetzner-prod/service-urls.auto.tfvars.json',
  ]) {
    if (!existsSync(resolve(root, relativePath))) {
      errors.push(`generated service wiring file is missing: ${relativePath}`);
    }
  }

  const manifest = loadServiceManifest(resolve(root, 'apps/web/service-manifest.json'));
  const nginxPath = resolve(root, 'scripts/hetzner/nginx/fishing-assistant.conf');
  const originHttpNginxPath = resolve(
    root,
    'scripts/hetzner/nginx/fishing-assistant.origin-http.conf'
  );
  const dockerfilePath = resolve(root, 'docker/prod/Dockerfile');
  const reloadScriptPath = resolve(root, 'scripts/hetzner/reload-services-container.sh');
  const nginxDeployPath = resolve(root, 'scripts/hetzner/deploy-nginx.sh');
  const githubActionsDeployPath = resolve(root, 'scripts/hetzner/github-actions-deploy.sh');
  /** @type {Record<string, string | undefined>} */
  const prodObservabilitySources = Object.fromEntries(
    requiredProdObservabilityArtifacts.map((relativePath) => [
      relativePath,
      readOptionalRepositoryFile(root, relativePath),
    ])
  );

  if (!existsSync(nginxPath)) {
    errors.push(
      'nginx route/proxy verification failed: missing scripts/hetzner/nginx/fishing-assistant.conf'
    );
  } else {
    errors.push(...validateNginxRouting(readFileSync(nginxPath, 'utf8'), manifest));
  }

  if (!existsSync(originHttpNginxPath)) {
    errors.push(
      'nginx route/proxy verification failed: missing scripts/hetzner/nginx/fishing-assistant.origin-http.conf'
    );
  } else {
    errors.push(...validateNginxRouting(readFileSync(originHttpNginxPath, 'utf8'), manifest));
  }

  if (!existsSync(nginxDeployPath)) {
    errors.push('nginx deployment verification failed: missing scripts/hetzner/deploy-nginx.sh');
  } else {
    errors.push(...validateNginxDeployRuntime(readFileSync(nginxDeployPath, 'utf8')));
  }

  if (!existsSync(dockerfilePath)) {
    errors.push('Docker container runtime verification failed: missing docker/prod/Dockerfile');
  } else if (!existsSync(reloadScriptPath)) {
    errors.push(
      'Docker container runtime verification failed: missing scripts/hetzner/reload-services-container.sh'
    );
  } else {
    errors.push(
      ...validateDockerRuntime(
        readFileSync(dockerfilePath, 'utf8'),
        readFileSync(reloadScriptPath, 'utf8'),
        manifest
      )
    );
  }

  if (!existsSync(githubActionsDeployPath)) {
    errors.push(
      'GitHub Actions production deployment verification failed: missing scripts/hetzner/github-actions-deploy.sh'
    );
  } else {
    errors.push(
      ...validateGithubActionsDeployRuntime(readFileSync(githubActionsDeployPath, 'utf8'), manifest)
    );
  }

  errors.push(...validateProdObservabilityRuntime(prodObservabilitySources));

  return errors;
}

function main() {
  const errors = validateProdRuntimeRepository(repoRoot);
  if (errors.length > 0) {
    for (const error of errors) {
      fail(error);
    }
  }

  process.stdout.write('Production runtime fixture verified with nginx and Docker checks.\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export {
  validateDockerRuntime,
  validateGithubActionsDeployRuntime,
  validateNginxDeployRuntime,
  validateNginxRouting,
  validateProdObservabilityRuntime,
  validateProdRuntimeRepository,
};

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  validateDockerRuntime,
  validateGithubActionsDeployRuntime,
  validateNginxDeployRuntime,
  validateNginxRouting,
  validateProdObservabilityRuntime,
} from '../verify-prod-runtime.mjs';

const manifest = {
  services: [
    {
      name: 'chat-service',
      envSuffix: 'CHAT_SERVICE',
      apiPath: '/api/chat',
      proxyTarget: 'http://localhost:3201',
      serviceUrl: 'http://localhost:3201',
    },
    {
      name: 'knowledge-service',
      envSuffix: 'KNOWLEDGE_SERVICE',
      apiPath: '/api/knowledge',
      proxyTarget: 'http://localhost:3202',
      serviceUrl: 'http://localhost:3202',
    },
    {
      name: 'llm-usage-service',
      envSuffix: 'LLM_USAGE_SERVICE',
      apiPath: '/api/llm-usage',
      proxyTarget: 'http://localhost:3203',
      serviceUrl: 'http://localhost:3203',
    },
    {
      name: 'user-service',
      envSuffix: 'USER_SERVICE',
      apiPath: '/api/users',
      proxyTarget: 'http://localhost:3204',
      serviceUrl: 'http://localhost:3204',
    },
  ],
};

const validNginx = `
upstream fa_chat_service { server 127.0.0.1:3201; keepalive 16; }
upstream fa_knowledge_service { server 127.0.0.1:3202; keepalive 16; }
upstream fa_llm_usage_service { server 127.0.0.1:3203; keepalive 16; }
upstream fa_user_service { server 127.0.0.1:3204; keepalive 16; }
server {
  server_name fishing-assistant.online;
  root /var/www/fa/current;
  location = / {
    auth_basic "Fishing Assistant";
    auth_basic_user_file /etc/nginx/fa-site-basic-auth.htpasswd;
    try_files /index.html =404;
  }
  location = /index.html {
    auth_basic "Fishing Assistant";
    auth_basic_user_file /etc/nginx/fa-site-basic-auth.htpasswd;
    try_files /index.html =404;
  }
  location = /app { auth_basic off; try_files /index.html =404; }
  location /app/ { auth_basic off; try_files /index.html =404; }
  location = /healthz { return 200 "ok\\n"; }
  location ~ ^/api/[a-z0-9-]+/internal(?:/|$) { return 404; }
  location = /api/chat { proxy_pass http://fa_chat_service/; }
  location /api/chat/ { proxy_pass http://fa_chat_service/; }
  location = /api/knowledge { proxy_pass http://fa_knowledge_service/; }
  location /api/knowledge/ { proxy_pass http://fa_knowledge_service/; }
  location = /api/llm-usage { proxy_pass http://fa_llm_usage_service/; }
  location /api/llm-usage/ { proxy_pass http://fa_llm_usage_service/; }
  location = /api/users { proxy_pass http://fa_user_service/; }
  location /api/users/ { proxy_pass http://fa_user_service/; }
  location = /alerts/grafana { auth_basic off; proxy_pass http://127.0.0.1:9002; }
  location = /share { return 301 /share/; }
  location /share/ {
    proxy_ssl_server_name on;
    proxy_set_header Host storage.googleapis.com;
    proxy_set_header Authorization "";
    proxy_pass https://storage.googleapis.com/replace-with-shared-content-bucket/share/;
  }
  location / { try_files $uri $uri/ /index.html; }
}`;

const validDockerfile = `
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY . .
RUN pnpm run build:services && for service in chat-service knowledge-service llm-usage-service user-service; do cd "/app/apps/\${service}/dist" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false && cd /app; done
ENV FA_PROD_ENV_FILE=/etc/fa/.env.prod
EXPOSE 3201 3202 3203 3204
CMD ["pnpm", "exec", "pm2-runtime", "ecosystem.config.prod.cjs"]
`;

const validReloadScript = `
docker rm -f fa-services || true
docker run -d --name fa-services \\
  --restart unless-stopped \\
  --env-file /etc/fa/.env.prod \\
  -e FA_RELEASE_SHA="\${deploy_sha}" \\
  -v /etc/fa/keys/runtime-sa-key.json:/run/secrets/fa-runtime-sa-key.json:ro \\
  -p 127.0.0.1:3201:3201 \\
  -p 127.0.0.1:3202:3202 \\
  -p 127.0.0.1:3203:3203 \\
  -p 127.0.0.1:3204:3204 \\
  fa-services:abc123
`;

const validGithubActionsDeployScript = `
FA_AUTH0_DOMAIN="\${FA_AUTH0_DOMAIN:-}"
FA_AUTH0_CLIENT_ID="\${FA_AUTH0_CLIENT_ID:-}"
FA_AUTH0_AUDIENCE="\${FA_AUTH0_AUDIENCE:-}"
deploy_nginx="\${FA_DEPLOY_NGINX:-false}"
deploy_bootstrap_origin_http_only=false
site_basic_auth_header=""
load_site_basic_auth_header() {
  site_basic_auth_header="$(run_remote_capture "cat /opt/fishing-assistant/current/.fa/site-basic-auth.curl-header")"
}
validate_inputs() {
  [[ -n "\${FA_AUTH0_DOMAIN}" ]] || fail "FA_AUTH0_DOMAIN is required"
  [[ -n "\${FA_AUTH0_CLIENT_ID}" ]] || fail "FA_AUTH0_CLIENT_ID is required"
  [[ -n "\${FA_AUTH0_AUDIENCE}" ]] || fail "FA_AUTH0_AUDIENCE is required"
}
parse_args() {
  case "$1" in
    --bootstrap-origin-http-only)
      deploy_bootstrap_origin_http_only=true
      ;;
  esac
}
deploy_remote_release() {
  run_remote "sudo -n /usr/local/sbin/fa-load-secrets --auth0-domain \${quoted_auth0_domain} --auth0-client-id \${quoted_auth0_client_id} --auth0-audience \${quoted_auth0_audience} \${quoted_release_dir}"
  run_remote "cd \${quoted_release_dir} && set -a && . /etc/fa/.env.prod && set +a && GOOGLE_APPLICATION_CREDENTIALS=/etc/fa/keys/runtime-sa-key.json pnpm run verify:data-baseline"
  run_remote "sudo -n /usr/local/sbin/fa-deploy-nginx \${quoted_current_dir}"
  run_remote "sudo -n /usr/local/sbin/fa-load-observability-env \${quoted_current_dir} \${quoted_grafana_instance_url} \${quoted_loki_datasource_uid} \${quoted_alert_router_webhook_url}"
  run_remote "sudo -n /usr/local/sbin/fa-install-observability \${quoted_current_dir} \${quoted_sha} --with-alert-router"
}
assert_remote_http_200() {
  local url="$1"
  run_remote "status=\\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \${url}); [[ \\"\\\${status}\\" == \\"200\\" ]]"
}
assert_remote_http_status() { true; }
assert_remote_https_origin_http_200() {
  local path="$1"
  local resolve_arg=""
  local url=""
  printf -v resolve_arg '%q' "\${FA_PROD_DOMAIN}:443:127.0.0.1"
  printf -v url '%q' "https://\${FA_PROD_DOMAIN}\${path}"
  run_remote "status=\\$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' --resolve \${resolve_arg} \${url}); [[ \\"\\\${status}\\" == \\"200\\" ]]"
}
assert_remote_https_origin_http_status() { true; }
assert_https_edge_http_200() {
  local path="$1"
  local status=""
  status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' --resolve "\${FA_PROD_DOMAIN}:443:\${FA_HETZNER_PROD_HOST}" "https://\${FA_PROD_DOMAIN}\${path}")"
  [[ "\${status}" == "200" ]]
}
assert_https_edge_http_status() { true; }
verify_service_health() {
  assert_remote_http_200 http://127.0.0.1:3201/health
  assert_remote_http_200 http://127.0.0.1:3202/health
  assert_remote_http_200 http://127.0.0.1:3203/health
  assert_remote_http_200 http://127.0.0.1:3204/health
}
verify_local_origin_health() {
  if [[ "\${deploy_bootstrap_origin_http_only}" == "true" ]]; then
    assert_remote_http_200 http://127.0.0.1/healthz
    assert_remote_http_status http://127.0.0.1/ 401
    assert_remote_http_status http://127.0.0.1/index.html 401
    assert_remote_http_200 http://127.0.0.1/ "\${site_basic_auth_header}"
    assert_remote_http_200 http://127.0.0.1/index.html "\${site_basic_auth_header}"
    assert_remote_http_200 http://127.0.0.1/app
    assert_remote_http_200 http://127.0.0.1/api/chat/health
    assert_remote_http_200 http://127.0.0.1/api/knowledge/health
    assert_remote_http_200 http://127.0.0.1/api/llm-usage/health
    assert_remote_http_200 http://127.0.0.1/api/users/health
  else
    assert_remote_https_origin_http_200 /healthz
    verify_local_origin_homepage_basic_auth
  fi
}
verify_local_origin_homepage_basic_auth() {
  assert_remote_https_origin_http_status / 401
  assert_remote_https_origin_http_status /index.html 401
  assert_remote_https_origin_http_200 / "\${site_basic_auth_header}"
  assert_remote_https_origin_http_200 /index.html "\${site_basic_auth_header}"
  assert_remote_https_origin_http_200 /app
  assert_remote_https_origin_http_200 /api/chat/health
  assert_remote_https_origin_http_200 /api/knowledge/health
  assert_remote_https_origin_http_200 /api/llm-usage/health
  assert_remote_https_origin_http_200 /api/users/health
}
verify_https_edge_homepage_basic_auth() {
  assert_https_edge_http_status / 401
  assert_https_edge_http_status /index.html 401
  assert_https_edge_http_200 / "\${site_basic_auth_header}"
  assert_https_edge_http_200 /index.html "\${site_basic_auth_header}"
  assert_https_edge_http_200 /app
  assert_https_edge_http_200 /api/chat/health
  assert_https_edge_http_200 /api/knowledge/health
  assert_https_edge_http_200 /api/llm-usage/health
  assert_https_edge_http_200 /api/users/health
}
verify_https_edge_health() {
  assert_https_edge_http_200 /healthz
  verify_https_edge_homepage_basic_auth
}
verify_deployment() {
  verify_service_health
  verify_observability_health
  load_site_basic_auth_header
  verify_local_origin_health
  if [[ "\${deploy_bootstrap_origin_http_only}" == "true" ]]; then
    printf 'Skipped HTTPS edge health checks because --bootstrap-origin-http-only was set\\n'
  else
    verify_https_edge_health
  fi
}
verify_observability_health() {
  run_remote "systemctl is-active --quiet fa-alloy"
  run_remote "systemctl is-active --quiet fa-alert-router"
  assert_remote_http_200 http://127.0.0.1:9002/health
}
`;

const validNginxDeployScript = `
NGINX_SOURCE="\${SCRIPT_DIR}/nginx/fishing-assistant.conf"
ORIGIN_HTTP_SOURCE="\${SCRIPT_DIR}/nginx/fishing-assistant.origin-http.conf"
install_site_basic_auth_file() {
  local release_dir="$1"
  install -m 640 -o root -g www-data "\${release_dir}/.fa/site-basic-auth.htpasswd" /etc/nginx/fa-site-basic-auth.htpasswd
}
parse_args() {
  case "$1" in
    --origin-http-only)
      NGINX_SOURCE="\${ORIGIN_HTTP_SOURCE}"
      ;;
  esac
}
main() {
  install_site_basic_auth_file "\${release_dir}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
}
`;

const validProdAlloyTemplate = `
discovery.docker "fa_services" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "fa_services" {
  targets = discovery.docker.fa_services.targets

  rule {
    source_labels = ["__meta_docker_container_name"]
    regex = "/fa-services"
    action = "keep"
  }
}

loki.source.docker "fa_services" {
  host = "unix:///var/run/docker.sock"
  targets = discovery.relabel.fa_services.output
  labels = { service = "services", env = "{{ENVIRONMENT}}", host = "{{HOST}}", app = "fishing-assistant", source = "docker", sha = "{{SHA}}", runtime = "docker" }
}
loki.source.file "nginx" {
  targets = [
    { __path__ = "/var/log/nginx/*.log", service = "nginx", env = "{{ENVIRONMENT}}", host = "{{HOST}}", app = "fishing-assistant", source = "nginx", sha = "{{SHA}}", runtime = "nginx" },
  ]
  file_match {
    enabled = true
  }
}
loki.source.journal "alert_router" {
  matches = "_SYSTEMD_UNIT=fa-alert-router.service"
  labels = { app = "fishing-assistant", env = "{{ENVIRONMENT}}", host = "{{HOST}}", service = "alert-router", source = "journald", sha = "{{SHA}}", runtime = "systemd" }
}
`;

const validProdObservabilityFiles = {
  'scripts/observability/fa-alloy.service':
    'EnvironmentFile=-/etc/fa/observability.env\nExecStart=/usr/bin/alloy run --server.http.listen-addr=127.0.0.1:12346 /etc/fa/alloy/fa.alloy\n',
  'scripts/observability/install-alloy.sh':
    'node "${REPO_ROOT}/scripts/observability/render-alloy-config.mjs" --environment "${environment}" --host "${host_name}" --sha "${deploy_sha}" --output /etc/fa/alloy/fa.alloy\ninstall -m 0644 "${REPO_ROOT}/scripts/observability/fa-alloy.service" /etc/systemd/system/fa-alloy.service\nsystemctl daemon-reload\nsystemctl restart fa-alloy\n',
  'scripts/observability/render-alloy-config.mjs': 'export function renderAlloyConfig() {}\n',
  'scripts/observability/templates/fa-prod.alloy.tmpl': validProdAlloyTemplate,
  'scripts/observability/alert-router.mjs': '#!/usr/bin/env node\n',
  'scripts/hetzner/load-observability-env.sh':
    'OUTPUT_FILE="${OUTPUT_FILE:-/etc/fa/observability.env}"\nFA_GRAFANA_INSTANCE_URL="${FA_GRAFANA_INSTANCE_URL:-}"\nFA_GRAFANA_LOKI_DATASOURCE_UID="${FA_GRAFANA_LOKI_DATASOURCE_UID:-}"\nFA_ALERT_ROUTER_WEBHOOK_URL="${FA_ALERT_ROUTER_WEBHOOK_URL:-}"\nFA_GRAFANA_LOKI_URL\nFA_GRAFANA_LOKI_USERNAME\nFA_GRAFANA_LOKI_TOKEN\nFA_ALERT_ROUTER_WEBHOOK_SECRET\nFA_ALERT_ROUTER_GITHUB_TOKEN\n',
  'scripts/hetzner/install-observability.sh':
    'require_prod\nnode "${REPO_ROOT}/scripts/observability/render-alloy-config.mjs" --environment prod --host "${target_host}" --sha "${deploy_sha}" --output /etc/fa/alloy/fa.alloy\ninstall -m 0644 "${REPO_ROOT}/scripts/observability/fa-alloy.service" /etc/systemd/system/fa-alloy.service\ninstall -m 0644 "${REPO_ROOT}/scripts/hetzner/fa-alert-router.service" /etc/systemd/system/fa-alert-router.service\nsystemctl daemon-reload\nsystemctl restart fa-alloy\nsystemctl restart fa-alert-router\n',
  'scripts/hetzner/fa-alert-router.service':
    'Environment=FA_ALERT_ROUTER_BIND_HOST=127.0.0.1\nEnvironment=PORT=9002\nEnvironmentFile=-/etc/fa/observability.env\nExecStart=/usr/bin/node /opt/fishing-assistant/current/scripts/observability/alert-router.mjs\n',
};

describe('production runtime verifier', () => {
  it('accepts nginx routing that strips manifest API prefixes and blocks public internal routes', () => {
    expect(validateNginxRouting(validNginx, manifest)).toEqual([]);
  });

  it('rejects nginx routing that omits homepage Basic Auth or app exemption', () => {
    const errors = validateNginxRouting(
      validNginx
        .replace(
          '    auth_basic "Fishing Assistant";\n    auth_basic_user_file /etc/nginx/fa-site-basic-auth.htpasswd;\n    try_files /index.html =404;',
          '    try_files /index.html =404;'
        )
        .replace(
          'location = /app { auth_basic off; try_files /index.html =404; }',
          'location = /app { try_files /index.html =404; }'
        ),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'nginx config must protect / and /index.html with site Basic Auth',
        'nginx config must explicitly exempt /app from Basic Auth',
      ])
    );
  });

  it('rejects nginx routing that exposes public internal endpoints or misses manifest routes', () => {
    const errors = validateNginxRouting(
      validNginx
        .replace('location ~ ^/api/[a-z0-9-]+/internal(?:/|$) { return 404; }', '')
        .replace('location /api/knowledge/ { proxy_pass http://fa_knowledge_service/; }', ''),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'nginx config must block public /api/*/internal/* routes before service proxies',
        'nginx config must route /api/knowledge/ to upstream fa_knowledge_service with prefix stripping',
      ])
    );
  });

  it('rejects nginx routing when the internal block appears after user-service public proxy routes', () => {
    const source = validNginx
      .replace('  location ~ ^/api/[a-z0-9-]+/internal(?:/|$) { return 404; }\n', '')
      .replace(
        '  location /api/users/ { proxy_pass http://fa_user_service/; }',
        '  location /api/users/ { proxy_pass http://fa_user_service/; }\n  location ~ ^/api/[a-z0-9-]+/internal(?:/|$) { return 404; }'
      );

    expect(validateNginxRouting(source, manifest)).toContain(
      'nginx config must block public /api/*/internal/* routes before service proxies'
    );
  });

  it('rejects nginx routing that misses or broadens the Grafana alert webhook path', () => {
    const errors = validateNginxRouting(
      validNginx
        .replace(
          'location = /alerts/grafana { auth_basic off; proxy_pass http://127.0.0.1:9002; }',
          ''
        )
        .replace(
          'location / { try_files $uri $uri/ /index.html; }',
          'location ^~ /alerts/ { proxy_pass http://127.0.0.1:9002; }\n  location / { try_files $uri $uri/ /index.html; }'
        ),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'nginx config must proxy only /alerts/grafana to fa-alert-router on 127.0.0.1:9002',
        'nginx config must not expose broad /alerts/* routes',
      ])
    );
  });

  it('rejects nginx routing that strips alert-router request headers', () => {
    const errors = validateNginxRouting(
      validNginx
        .replace(
          'location = /alerts/grafana { auth_basic off; proxy_pass http://127.0.0.1:9002; }',
          'location = /alerts/grafana { auth_basic off; proxy_pass_request_headers off; proxy_pass http://127.0.0.1:9002; }'
        )
        .replace(
          'server_name fishing-assistant.online;',
          'server_name fishing-assistant.online;\n  proxy_set_header X-FA-Alert-Secret "";'
        ),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'nginx config must preserve request headers for fa-alert-router',
        'nginx config must preserve X-FA-Alert-Secret for fa-alert-router',
      ])
    );
  });

  it('rejects nginx routing that cannot serve shared content through product /share/ URLs', () => {
    const errors = validateNginxRouting(
      validNginx.replace('location = /share { return 301 /share/; }', '').replace(
        `location /share/ {
    proxy_ssl_server_name on;
    proxy_set_header Host storage.googleapis.com;
    proxy_set_header Authorization "";
    proxy_pass https://storage.googleapis.com/replace-with-shared-content-bucket/share/;
  }`,
        ''
      ),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'nginx config must redirect /share to /share/',
        'nginx config must route /share/ to the shared-content GCS bucket',
        'nginx config must set storage.googleapis.com Host header for /share/',
        'nginx config must clear Authorization header for /share/',
        'nginx config must enable TLS SNI for /share/ upstream',
      ])
    );
  });

  it('accepts Docker/PM2 runtime that publishes every backend service on host loopback only', () => {
    expect(validateDockerRuntime(validDockerfile, validReloadScript, manifest)).toEqual([]);
  });

  it('accepts the checked-in nginx and Docker runtime artifacts', () => {
    const normalNginx = readFileSync(
      new URL('../hetzner/nginx/fishing-assistant.conf', import.meta.url),
      'utf8'
    );
    const originHttpNginx = readFileSync(
      new URL('../hetzner/nginx/fishing-assistant.origin-http.conf', import.meta.url),
      'utf8'
    );
    const dockerfile = readFileSync(
      new URL('../../docker/prod/Dockerfile', import.meta.url),
      'utf8'
    );
    const reloadScript = readFileSync(
      new URL('../hetzner/reload-services-container.sh', import.meta.url),
      'utf8'
    );

    expect(validateNginxRouting(normalNginx, manifest)).toEqual([]);
    expect(validateNginxRouting(originHttpNginx, manifest)).toEqual([]);
    expect(validateDockerRuntime(dockerfile, reloadScript, manifest)).toEqual([]);
  });

  it('rejects Docker runtime that does not use pm2-runtime or loopback-only ports', () => {
    const errors = validateDockerRuntime(
      validDockerfile.replace('pm2-runtime', 'pm2'),
      validReloadScript.replace('-p 127.0.0.1:3202:3202', '-p 3202:3202'),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'docker/prod/Dockerfile must start production services with pm2-runtime and ecosystem.config.prod.cjs',
        'scripts/hetzner/reload-services-container.sh must publish knowledge-service on 127.0.0.1:3202:3202',
      ])
    );
  });

  it('rejects Docker runtime that misses generated dist runtime dependency installation', () => {
    const errors = validateDockerRuntime(
      validDockerfile.replace('npm install --omit=dev', 'echo skip-runtime-deps'),
      validReloadScript,
      manifest
    );

    expect(errors).toContain(
      'docker/prod/Dockerfile must install generated dist runtime dependencies for backend services'
    );
  });

  it('accepts GitHub deploy runtime that checks HTTPS edge health by default', () => {
    expect(validateGithubActionsDeployRuntime(validGithubActionsDeployScript, manifest)).toEqual(
      []
    );
  });

  it('accepts the checked-in GitHub Actions deploy runtime script', () => {
    const deployScript = readFileSync(
      new URL('../hetzner/github-actions-deploy.sh', import.meta.url),
      'utf8'
    );

    expect(validateGithubActionsDeployRuntime(deployScript, manifest)).toEqual([]);
  });

  it('requires the checked-in services image build to free unused Docker space before building', () => {
    const buildScript = readFileSync(
      new URL('../hetzner/build-services-image.sh', import.meta.url),
      'utf8'
    );
    const cleanupCallIndex = buildScript.indexOf('  prune_docker_build_space');
    const cdIndex = buildScript.indexOf('  cd "${repo_dir}"');
    const buildIndex = buildScript.indexOf('  docker build -f docker/prod/Dockerfile');

    expect(buildScript).toContain('docker system df');
    expect(buildScript).toContain('docker container prune -f');
    expect(buildScript).toContain('docker image prune -af');
    expect(buildScript).toContain('docker builder prune -af');
    expect(cdIndex).toBeGreaterThanOrEqual(0);
    expect(cleanupCallIndex).toBeGreaterThan(cdIndex);
    expect(buildIndex).toBeGreaterThan(cleanupCallIndex);
  });

  it('requires checked-in deploy verification to wait and name final health failures', () => {
    const deployScript = readFileSync(
      new URL('../hetzner/github-actions-deploy.sh', import.meta.url),
      'utf8'
    );

    expect(deployScript).toContain('wait_for_remote_http_status()');
    expect(deployScript).toContain('wait_for_remote_https_origin_http_status()');
    expect(deployScript).toContain('wait_for_https_edge_http_status()');
    expect(deployScript).toContain('wait_for_remote_systemd_active()');
    expect(deployScript).toContain('Timed out waiting for');
    expect(deployScript).toContain('last status');
  });

  it('rejects GitHub deploy runtime that receives long-lived cloud service-account keys', () => {
    const errors = validateGithubActionsDeployRuntime(
      `${validGithubActionsDeployScript}
FA_HETZNER_PROVISIONER_SERVICE_ACCOUNT_KEY="\${FA_HETZNER_PROVISIONER_SERVICE_ACCOUNT_KEY:-}"
FA_HETZNER_RUNTIME_SERVICE_ACCOUNT_KEY="\${FA_HETZNER_RUNTIME_SERVICE_ACCOUNT_KEY:-}"
install_service_account_keys
`,
      manifest
    );

    expect(errors).toContain(
      'scripts/hetzner/github-actions-deploy.sh must not receive or install long-lived cloud service-account keys from GitHub Actions'
    );
  });

  it('rejects GitHub deploy runtime that misses live runtime data baseline verification', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript.replace(
        'pnpm run verify:data-baseline',
        'echo skip-auth-baseline-reset'
      ),
      manifest
    );

    expect(errors).toContain(
      'scripts/hetzner/github-actions-deploy.sh must run live runtime data baseline verification with the production runtime service account after loading secrets'
    );
  });

  it('rejects GitHub deploy runtime that does not pass public Auth0 config to the secrets wrapper', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript
        .replace('FA_AUTH0_DOMAIN="${FA_AUTH0_DOMAIN:-}"', '')
        .replace('FA_AUTH0_CLIENT_ID="${FA_AUTH0_CLIENT_ID:-}"', '')
        .replace('FA_AUTH0_AUDIENCE="${FA_AUTH0_AUDIENCE:-}"', '')
        .replace('FA_AUTH0_DOMAIN is required', 'missing auth0 domain')
        .replace('FA_AUTH0_CLIENT_ID is required', 'missing auth0 client')
        .replace('FA_AUTH0_AUDIENCE is required', 'missing auth0 audience')
        .replace(
          ' --auth0-domain ${quoted_auth0_domain} --auth0-client-id ${quoted_auth0_client_id} --auth0-audience ${quoted_auth0_audience}',
          ''
        ),
      manifest
    );

    expect(errors).toContain(
      'scripts/hetzner/github-actions-deploy.sh must pass public Auth0 runtime config to fa-load-secrets as explicit sudo wrapper arguments'
    );
  });

  it('rejects GitHub deploy runtime that omits homepage Basic Auth verification', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript
        .replaceAll('verify_local_origin_homepage_basic_auth', 'verify_local_origin_health_only')
        .replaceAll('verify_https_edge_homepage_basic_auth', 'verify_https_edge_health_only'),
      manifest
    );

    expect(errors).toContain(
      'scripts/hetzner/github-actions-deploy.sh must verify homepage Basic Auth on local-origin and HTTPS edge routes'
    );
  });

  it('rejects GitHub deploy runtime that misses observability wrappers or health checks', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript
        .replace('/usr/local/sbin/fa-load-observability-env', 'true # skip observability env')
        .replace('/usr/local/sbin/fa-install-observability', 'true # skip observability install')
        .replace('systemctl is-active --quiet fa-alloy', 'systemctl status fa-alloy')
        .replace('http://127.0.0.1:9002/health', 'http://127.0.0.1:9002/'),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'scripts/hetzner/github-actions-deploy.sh must load and install production Grafana observability through sudo wrappers',
        'scripts/hetzner/github-actions-deploy.sh must verify fa-alloy and fa-alert-router after deploy',
      ])
    );
  });

  it('rejects GitHub deploy runtime that gates HTTPS edge health on deploy_nginx', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript
        .replaceAll(
          'if [[ "${deploy_bootstrap_origin_http_only}" == "true" ]]',
          'if [[ "${deploy_nginx}" == "true" ]]'
        )
        .replace('http://127.0.0.1:3202/health', 'http://127.0.0.1/healthz'),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'scripts/hetzner/github-actions-deploy.sh must run HTTPS edge health checks by default unless --bootstrap-origin-http-only is set',
        'scripts/hetzner/github-actions-deploy.sh must verify knowledge-service service health on 127.0.0.1:3202',
      ])
    );
  });

  it('rejects GitHub deploy runtime that allows ambient env to enable bootstrap HTTPS skip', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript.replace(
        'deploy_bootstrap_origin_http_only=false',
        'deploy_bootstrap_origin_http_only="${FA_DEPLOY_BOOTSTRAP_ORIGIN_HTTP_ONLY:-false}"'
      ),
      manifest
    );

    expect(errors).toContain(
      'scripts/hetzner/github-actions-deploy.sh must initialize deploy_bootstrap_origin_http_only=false and set it only from --bootstrap-origin-http-only'
    );
  });

  it('rejects GitHub deploy runtime health checks that accept redirects instead of HTTP 200', () => {
    const errors = validateGithubActionsDeployRuntime(
      validGithubActionsDeployScript.replaceAll("--write-out '%{http_code}'", ''),
      manifest
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'scripts/hetzner/github-actions-deploy.sh must assert HTTP 200 for local nginx origin health checks',
        'scripts/hetzner/github-actions-deploy.sh must assert HTTP 200 for HTTPS edge health checks',
      ])
    );
  });

  it('accepts nginx deploy runtime that supports explicit origin HTTP-only mode', () => {
    expect(validateNginxDeployRuntime(validNginxDeployScript)).toEqual([]);
  });

  it('rejects nginx deploy runtime that cannot install the pre-Cloudflare origin config', () => {
    const errors = validateNginxDeployRuntime(
      validNginxDeployScript
        .replace('--origin-http-only', '--skip-certbot')
        .replace('fishing-assistant.origin-http.conf', 'missing.conf')
        .replace('nginx -t', 'true')
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'scripts/hetzner/deploy-nginx.sh must support explicit origin HTTP-only nginx deployment before Cloudflare TLS is ready',
        'scripts/hetzner/deploy-nginx.sh must validate nginx config before reload',
      ])
    );
  });

  it('rejects nginx deploy runtime that does not install the Basic Auth file for nginx', () => {
    const errors = validateNginxDeployRuntime(
      validNginxDeployScript
        .replace(
          'install -m 640 -o root -g www-data "${release_dir}/.fa/site-basic-auth.htpasswd" /etc/nginx/fa-site-basic-auth.htpasswd',
          'true'
        )
        .replace('install_site_basic_auth_file "${release_dir}"', 'true')
    );

    expect(errors).toContain(
      'scripts/hetzner/deploy-nginx.sh must install the release Basic Auth file to /etc/nginx/fa-site-basic-auth.htpasswd for nginx worker access'
    );
  });

  it('accepts production observability runtime artifacts aligned with nginx and Docker logs', () => {
    expect(validateProdObservabilityRuntime(validProdObservabilityFiles)).toEqual([]);
  });

  it('rejects production observability runtime artifacts that miss Alloy install pieces or drift from log sources', () => {
    const errors = validateProdObservabilityRuntime({
      ...validProdObservabilityFiles,
      'scripts/observability/render-alloy-config.mjs': undefined,
      'scripts/observability/fa-alloy.service':
        'EnvironmentFile=-/etc/fa/observability.env\nExecStart=/usr/bin/alloy run /etc/fa/alloy/fa.alloy\n',
      'scripts/observability/templates/fa-prod.alloy.tmpl': validProdAlloyTemplate
        .replace('regex = "/fa-services"', 'regex = "/wrong-services"')
        .replace('/var/log/nginx/*.log', '/tmp/nginx.log')
        .replace('_SYSTEMD_UNIT=fa-alert-router.service', '_SYSTEMD_UNIT=wrong.service'),
      'scripts/hetzner/load-observability-env.sh': 'touch /tmp/observability.env\n',
      'scripts/hetzner/install-observability.sh': 'systemctl restart fa-alloy\n',
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        'missing production observability runtime artifact: scripts/observability/render-alloy-config.mjs',
        'scripts/observability/fa-alloy.service must load /etc/fa/observability.env and run /etc/fa/alloy/fa.alloy on the dedicated FA Alloy HTTP port',
        'scripts/observability/templates/fa-prod.alloy.tmpl must collect Docker logs from the fa-services container',
        'scripts/observability/templates/fa-prod.alloy.tmpl must collect nginx logs from /var/log/nginx/*.log',
        'scripts/observability/templates/fa-prod.alloy.tmpl must collect fa-alert-router journald logs',
        'scripts/hetzner/load-observability-env.sh must write /etc/fa/observability.env from FA Grafana and alert-router values',
        'scripts/hetzner/install-observability.sh must render prod Alloy config and install fa-alloy plus fa-alert-router systemd units',
      ])
    );
  });
});

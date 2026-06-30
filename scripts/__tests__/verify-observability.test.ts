import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateObservabilityRepository } from '../verify-observability.mjs';

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function withObservabilityFixture<T>(files: Record<string, string>, run: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-verify-observability-'));

  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      writeFile(root, relativePath, contents);
    }

    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const validAlertRules = `
apiVersion: 1
groups:
  - orgId: 1
    name: fa-log-alerts
    folder: Fishing Assistant
    interval: 1m
    rules:
      - uid: fa-backend-error-logs
        title: FA Backend Error Logs
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} | json | level="error" [5m])) > 0'
      - uid: fa-nginx-5xx
        title: FA Nginx 5xx
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant", source="nginx"} |= " 5" [5m])) > 3'
      - uid: fa-usage-ingest-failure
        title: FA Usage Ingest Failure
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} |= "Usage service ingest request failed" [10m])) > 0'
      - uid: fa-deploy-failure
        title: FA Deploy Failure
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant", service="deploy", source="journald"} |~ "(?i)(failed|error)" [10m])) > 0'
      - uid: fa-no-logs-received
        title: FA No Logs Received
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (absent_over_time({app="fishing-assistant", service=~".+"}[15m]))'
      - uid: fa-user-service-no-logs
        title: FA User Service No Logs
        data:
          - refId: A
            model:
              expr: 'sum by (env) (count_over_time({app="fishing-assistant", source="docker", service="services"} | json service_name="service" | service_name="user-service" [15m])) < 1'
      - uid: fa-user-service-down
        title: FA User Service Down
        data:
          - refId: A
            model:
              expr: 'count_over_time({app="fishing-assistant", source="nginx"} |= "/api/users/health" |~ "\\\\s5[0-9]{2}\\\\s" [5m]) > 0'
      - uid: fa-auth-resolver-failures
        title: FA Auth Resolver Failures
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} | json | event="auth_resolver_unavailable" [5m])) > 0'
      - uid: fa-auth-failure-spike
        title: FA Auth Failure Spike
        data:
          - refId: A
            model:
              expr: 'sum by (service, env, event) (count_over_time({app="fishing-assistant"} | json | event=~"auth_bearer_invalid|auth_jwt_invalid|auth_resolver_denied|auth_admin_required|auth_internal_failed" [5m])) > 20'
      - uid: fa-knowledge-access-refresh-jobs-failed
        title: FAKnowledgeAccessRefreshJobsFailed
        annotations:
          summary: 'Access refresh failures detected; lifecycle events include knowledge_access_refresh_job_claimed and knowledge_access_refresh_job_succeeded'
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} |= "knowledge_access_refresh_job_failed" [10m])) > 0'
      - uid: fa-knowledge-access-chunks-stale
        title: FAKnowledgeAccessChunksStale
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} |= "knowledge_access_chunk_marked_stale" [10m])) > 0'
      - uid: fa-knowledge-access-revision-mismatch
        title: FAKnowledgeAccessRevisionMismatch
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} |= "knowledge_access_mismatch_detected" [10m])) > 0'
      - uid: fa-knowledge-source-url-rejected
        title: FAKnowledgeSourceUrlRejected
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} |= "knowledge_source_url_rejected" [10m])) > 0'
      - uid: fa-knowledge-rag-leak-guard-excluded-candidates
        title: FAKnowledgeRagLeakGuardExcludedCandidates
        data:
          - refId: A
            model:
              expr: 'sum by (service, env) (count_over_time({app="fishing-assistant"} |= "knowledge_rag_candidate_excluded" [10m])) > 0'
`;

const validContactPoints = `
apiVersion: 1
contactPoints:
  - orgId: 1
    name: fa-alert-router
    receivers:
      - uid: fa-alert-router-webhook
        type: webhook
        settings:
          url: \${FA_ALERT_ROUTER_WEBHOOK_URL}
          httpMethod: POST
          httpHeaderName1: X-FA-Alert-Secret
          httpHeaderValue1: \${FA_ALERT_ROUTER_WEBHOOK_SECRET}
`;

const validNotificationPolicies = `
apiVersion: 1
policies:
  - orgId: 1
    receiver: fa-alert-router
    group_by: ["alertname", "service", "env"]
`;

const validDashboard = JSON.stringify(
  {
    uid: 'fa-logs',
    title: 'Fishing Assistant Logs',
    templating: {
      list: [
        { name: 'datasource', current: { value: 'grafanacloud-logs' } },
        { name: 'env', query: 'label_values({app="fishing-assistant"}, env)' },
        {
          name: 'service',
          query: 'label_values({app="fishing-assistant", env=~"$env"}, service)',
        },
        {
          name: 'source',
          query:
            'label_values({app="fishing-assistant", env=~"$env", service=~"$service"}, source)',
        },
      ],
    },
    panels: [
      {
        title: 'Live FA Logs',
        targets: [
          {
            expr: '{app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"}',
          },
        ],
      },
      {
        title: 'Latest FA Errors',
        targets: [
          {
            expr: '{app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"} |~ "(?i)(error|fail)"',
          },
        ],
      },
      {
        title: 'FA Log Volume by Service',
        targets: [
          {
            expr: 'sum by (env, service) (rate({app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"}[$__rate_interval]))',
          },
        ],
      },
      {
        title: 'FA Auth Resolver Failures',
        targets: [
          {
            expr: 'sum by (env, service) (count_over_time({app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"} | json | event="auth_resolver_unavailable"[$__rate_interval]))',
          },
        ],
      },
      {
        title: 'FA Auth Failure Events',
        targets: [
          {
            expr: 'sum by (env, service, event) (count_over_time({app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"} | json | event=~"auth_bearer_missing|auth_bearer_invalid|auth_jwt_invalid|auth_resolver_denied|auth_resolver_unavailable|auth_admin_required|auth_internal_failed"[$__rate_interval]))',
          },
        ],
      },
      {
        title: 'FA User Service Health 5xx',
        targets: [
          {
            expr: 'count_over_time({app="fishing-assistant", env=~"$env", source="nginx"} |= "/api/users/health" |~ "\\\\s5[0-9]{2}\\\\s"[$__rate_interval])',
          },
        ],
      },
      {
        title: 'FA Usage Ingest Failures',
        targets: [
          {
            expr: 'sum by (env, service) (count_over_time({app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"} |= "Usage service ingest request failed"[$__rate_interval]))',
          },
        ],
      },
      {
        title: 'FA Knowledge Access Monitors',
        targets: [
          {
            expr: 'sum by (env, service) (count_over_time({app="fishing-assistant", env=~"$env", service=~"$service", source=~"$source"} |= "knowledge_access_refresh_job_failed"[$__rate_interval]))',
          },
        ],
      },
    ],
  },
  null,
  2
);

const validDevAlloyTemplate = `
loki.source.file "pm2" {
  targets = [
    { __path__ = "{{PM2_LOG_DIR}}/fa-chat-service-*.log", app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "chat-service", host = "{{HOST}}", source = "pm2" },
    { __path__ = "{{PM2_LOG_DIR}}/fa-knowledge-service-*.log", app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "knowledge-service", host = "{{HOST}}", source = "pm2" },
    { __path__ = "{{PM2_LOG_DIR}}/fa-llm-usage-service-*.log", app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "llm-usage-service", host = "{{HOST}}", source = "pm2" },
    { __path__ = "{{PM2_LOG_DIR}}/fa-user-service-*.log", app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "user-service", host = "{{HOST}}", source = "pm2" },
    { __path__ = "{{PM2_LOG_DIR}}/fa-web-*.log", app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "web", host = "{{HOST}}", source = "pm2" }
  ]
  file_match {
    enabled = true
  }
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
  labels = { app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "services", host = "{{HOST}}", source = "docker", sha = "{{SHA}}", runtime = "docker" }
}

loki.source.file "nginx" {
  targets = [{ __path__ = "/var/log/nginx/*.log", app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "nginx", host = "{{HOST}}", source = "nginx", sha = "{{SHA}}", runtime = "nginx" }]
  file_match {
    enabled = true
  }
}

loki.source.journal "deploy" {
  matches = "_SYSTEMD_UNIT=fa-deploy.service"
  labels = { app = "fishing-assistant", env = "{{ENVIRONMENT}}", service = "deploy", host = "{{HOST}}", source = "journald", sha = "{{SHA}}", runtime = "systemd" }
}
`;

const validCoreFiles = {
  'scripts/observability/grafana/alert-rules.yml': validAlertRules,
  'scripts/observability/grafana/contact-points.yml': validContactPoints,
  'scripts/observability/grafana/dashboard-fa-logs.json': validDashboard,
  'scripts/observability/grafana/notification-policies.yml': validNotificationPolicies,
  'scripts/observability/grafana/README.md':
    '# FA Grafana Alert Templates\n\nUse placeholders only; do not commit secrets.\n',
  'scripts/observability/templates/fa-dev.alloy.tmpl': validDevAlloyTemplate,
  'scripts/observability/templates/fa-prod.alloy.tmpl': validProdAlloyTemplate,
};

const validReadAccessFiles = {
  '.codex/skills/grafana-logs/SKILL.md':
    '---\nname: grafana-logs\ndescription: Query FA Grafana Loki logs.\n---\nUse only Grafana Loki read access.\n',
  '.codex/skills/grafana-logs/scripts/query-loki.mjs': 'console.log("loki")\n',
  '.codex/skills/grafana-logs/scripts/conversation-logs.mjs': 'console.log("loki")\n',
  'docs/operations/fa-observability-runbook.md':
    '## Read Access For Incident Debugging\nFA_GRAFANA_LOKI_READ_URL\nFA_GRAFANA_LOKI_READ_USERNAME\nFA_GRAFANA_LOKI_READ_TOKEN\nlogs:read\n{app="fishing-assistant", env=~"dev|prod"}\n',
  '.env.example':
    'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
  '.env.dev.example':
    'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
  '.env.prod.example':
    'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
};

const validFiles = {
  ...validCoreFiles,
  ...validReadAccessFiles,
};

describe('observability verifier', () => {
  it('requires the Grafana logs skill and read-access documentation', () => {
    withObservabilityFixture(validCoreFiles, (root) => {
      expect(validateObservabilityRepository(root)).toEqual(
        expect.arrayContaining([
          'Missing observability artifact: .codex/skills/grafana-logs/SKILL.md',
          'Missing observability artifact: .codex/skills/grafana-logs/scripts/query-loki.mjs',
          'Missing observability artifact: .codex/skills/grafana-logs/scripts/conversation-logs.mjs',
          'docs/operations/fa-observability-runbook.md must document Grafana Loki read access for incident debugging',
          '.env.example must document FA_GRAFANA_LOKI_READ_URL',
          '.env.dev.example must document FA_GRAFANA_LOKI_READ_USERNAME',
          '.env.prod.example must document FA_GRAFANA_LOKI_READ_TOKEN',
        ])
      );
    });
  });

  it('rejects host-local fallback log commands in the Grafana logs skill', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        '.codex/skills/grafana-logs/SKILL.md':
          '---\nname: grafana-logs\ndescription: Query FA Grafana Loki logs.\n---\nUse Loki. Run `pm2 logs` if Loki fails.\n',
        '.codex/skills/grafana-logs/scripts/query-loki.mjs': 'console.log("ssh host")\n',
        '.codex/skills/grafana-logs/scripts/conversation-logs.mjs':
          'console.log("journalctl -u fa")\n',
        'docs/operations/fa-observability-runbook.md':
          '## Read Access For Incident Debugging\nFA_GRAFANA_LOKI_READ_URL\nFA_GRAFANA_LOKI_READ_USERNAME\nFA_GRAFANA_LOKI_READ_TOKEN\nlogs:read\n',
        '.env.example':
          'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
        '.env.dev.example':
          'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
        '.env.prod.example':
          'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            '.codex/skills/grafana-logs/SKILL.md must not include host-local log fallback command pm2 logs',
            '.codex/skills/grafana-logs/scripts/query-loki.mjs must not include host-local log fallback command ssh',
            '.codex/skills/grafana-logs/scripts/conversation-logs.mjs must not include host-local log fallback command journalctl',
          ])
        );
      }
    );
  });

  it('rejects rendering Grafana Loki read secrets into deploy and runtime surfaces', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        '.codex/skills/grafana-logs/SKILL.md':
          '---\nname: grafana-logs\ndescription: Query FA Grafana Loki logs.\n---\nUse only Grafana Loki read access.\n',
        '.codex/skills/grafana-logs/scripts/query-loki.mjs': 'console.log("loki")\n',
        '.codex/skills/grafana-logs/scripts/conversation-logs.mjs': 'console.log("loki")\n',
        'docs/operations/fa-observability-runbook.md':
          '## Read Access For Incident Debugging\nFA_GRAFANA_LOKI_READ_URL\nFA_GRAFANA_LOKI_READ_USERNAME\nFA_GRAFANA_LOKI_READ_TOKEN\nlogs:read\n',
        '.env.example':
          'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
        '.env.dev.example':
          'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
        '.env.prod.example':
          'FA_GRAFANA_LOKI_READ_URL=\nFA_GRAFANA_LOKI_READ_USERNAME=\nFA_GRAFANA_LOKI_READ_TOKEN=\n',
        'scripts/hetzner/load-observability-env.sh':
          'FA_OBSERVABILITY_SECRETS=(FA_GRAFANA_LOKI_READ_TOKEN)\n',
        'scripts/hetzner/fa-alert-router.service':
          'EnvironmentFile=-/etc/fa/observability.env\nEnvironment=FA_GRAFANA_LOKI_READ_URL=x\n',
        'terraform/gcp-data-plane/main.tf':
          'runtime_secret_names = toset(["FA_GRAFANA_LOKI_READ_USERNAME"])\nprovisioning_secret_names = toset(["FA_GRAFANA_LOKI_READ_TOKEN"])\n',
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/hetzner/load-observability-env.sh must not render FA_GRAFANA_LOKI_READ_TOKEN into deployed observability env',
            'scripts/hetzner/fa-alert-router.service must not expose FA_GRAFANA_LOKI_READ_URL to deployed services',
            'terraform/gcp-data-plane/main.tf must not grant deployed runtime/provisioning access to FA_GRAFANA_LOKI_READ_USERNAME',
            'terraform/gcp-data-plane/main.tf must not grant deployed runtime/provisioning access to FA_GRAFANA_LOKI_READ_TOKEN',
          ])
        );
      }
    );
  });

  it('rejects Grafana Loki read secrets in broader deploy and provisioning surfaces', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/deploy/deploy-dev.sh': 'echo "$FA_GRAFANA_LOKI_READ_URL"\n',
        'scripts/observability/install-alloy.sh': 'echo "$FA_GRAFANA_LOKI_READ_TOKEN"\n',
        'terraform/hetzner-prod/main.tf':
          'environment = { FA_GRAFANA_LOKI_READ_USERNAME = "bad" }\n',
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/deploy/deploy-dev.sh must not reference FA_GRAFANA_LOKI_READ_URL in deploy/runtime/provisioning surfaces',
            'scripts/observability/install-alloy.sh must not reference FA_GRAFANA_LOKI_READ_TOKEN in deploy/runtime/provisioning surfaces',
            'terraform/hetzner-prod/main.tf must not reference FA_GRAFANA_LOKI_READ_USERNAME in deploy/runtime/provisioning surfaces',
          ])
        );
      }
    );
  });

  it('accepts Grafana alert templates with required LogQL and placeholders', () => {
    withObservabilityFixture(validFiles, (root) => {
      expect(validateObservabilityRepository(root)).toEqual([]);
    });
  });

  it('requires alert templates and named rules for required production signals', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/observability/grafana/alert-rules.yml': 'apiVersion: 1\n',
        'scripts/observability/grafana/contact-points.yml': 'apiVersion: 1\n',
        'scripts/observability/grafana/dashboard-fa-logs.json': '{}\n',
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/observability/grafana/alert-rules.yml must include alert FA Backend Error Logs',
            'scripts/observability/grafana/alert-rules.yml must include alert FA Nginx 5xx',
            'scripts/observability/grafana/alert-rules.yml must include alert FA Usage Ingest Failure',
            'scripts/observability/grafana/alert-rules.yml must include alert FA Deploy Failure',
            'scripts/observability/grafana/alert-rules.yml must include alert FA No Logs Received',
            'scripts/observability/grafana/alert-rules.yml must include alert FA User Service No Logs',
            'scripts/observability/grafana/alert-rules.yml must include alert FA User Service Down',
            'scripts/observability/grafana/alert-rules.yml must include alert FA Auth Resolver Failures',
            'scripts/observability/grafana/alert-rules.yml must include alert FA Auth Failure Spike',
            'scripts/observability/grafana/alert-rules.yml must include alert FAKnowledgeAccessRefreshJobsFailed',
            'scripts/observability/grafana/alert-rules.yml must include log event knowledge_access_refresh_job_failed',
            'scripts/observability/grafana/alert-rules.yml must include count_over_time LogQL',
            'scripts/observability/grafana/contact-points.yml must define a webhook contact point with placeholder URL and secret',
            'scripts/observability/grafana/dashboard-fa-logs.json must define the FA logs dashboard with app/env/service/source LogQL',
          ])
        );
      }
    );
  });

  it('rejects Sentry references, likely secrets, missing Loki labels, and unsafe Alloy scrapes', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/observability/grafana/alert-rules.yml': validAlertRules.replace(
          '{app="fishing-assistant"}',
          '{job="fa"}'
        ),
        'scripts/observability/grafana/contact-points.yml':
          'apiVersion: 1\nurl: https://alerts.example.com/grafana\nsecret: real-token-1234567890abcdef\nFA_SENTRY_DSN: bad\n',
        'scripts/observability/templates/fa-dev.alloy.tmpl':
          'local.file "pm2_env" { filename = "/tmp/pm2-jlist.json" }\n# pm2 jlist process.env\n',
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'Forbidden Sentry reference in scripts/observability/grafana/contact-points.yml',
            'Likely secret literal in scripts/observability/grafana/contact-points.yml',
            'scripts/observability/grafana/contact-points.yml must define a webhook contact point with placeholder URL and secret',
            'scripts/observability/grafana/alert-rules.yml must query Loki labels app, env, and service',
            'scripts/observability/templates/fa-dev.alloy.tmpl must not scrape PM2 jlist output or environment dumps',
          ])
        );
      }
    );
  });

  it('requires Alloy file glob discovery, user-service coverage, and Docker discovery for production logs', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/observability/templates/fa-dev.alloy.tmpl': `
loki.source.file "pm2" {
  targets = [{ __path__ = "{{PM2_LOG_DIR}}/fa-chat-service-*.log" }]
}
`,
        'scripts/observability/templates/fa-prod.alloy.tmpl': `
loki.source.docker "fa_services" {
  host = "unix:///var/run/docker.sock"
  targets = [{ container_name = "fa-services" }]
}

loki.source.file "nginx" {
  targets = [{ __path__ = "/var/log/nginx/*.log" }]
}
`,
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/observability/templates/fa-dev.alloy.tmpl must enable Alloy file_match for globbed file sources',
            'scripts/observability/templates/fa-dev.alloy.tmpl must collect PM2 logs for service user-service',
            'scripts/observability/templates/fa-prod.alloy.tmpl must enable Alloy file_match for globbed file sources',
            'scripts/observability/templates/fa-prod.alloy.tmpl must discover and keep the fa-services Docker container before loki.source.docker',
          ])
        );
      }
    );
  });

  it('requires service/env grouping and per-service no-logs alerts', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/observability/grafana/alert-rules.yml': validAlertRules
          .replaceAll('sum by (service, env)', 'sum')
          .replace(
            'absent_over_time({app="fishing-assistant", service=~".+"}[15m])',
            'absent_over_time({app="fishing-assistant"}[15m])'
          ),
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/observability/grafana/alert-rules.yml must query Loki labels app, env, and service',
            'scripts/observability/grafana/alert-rules.yml must include per-service no-logs-received LogQL',
          ])
        );
      }
    );
  });

  it('requires the exact user-service, auth, usage, and knowledge LogQL coverage from the spec', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/observability/grafana/alert-rules.yml': validAlertRules
          .replace(
            '{app="fishing-assistant", source="docker", service="services"} | json service_name="service" | service_name="user-service" [15m]',
            '{app="fishing-assistant", source="docker", service="services"}[15m]'
          )
          .replace(
            '{app="fishing-assistant", source="nginx"} |= "/api/users/health" |~ "\\\\s5[0-9]{2}\\\\s" [5m]',
            '{app="fishing-assistant", source="nginx"} |= "/health" [5m]'
          )
          .replace('event="auth_resolver_unavailable"', 'event="resolver_down"')
          .replace(
            'event=~"auth_bearer_invalid|auth_jwt_invalid|auth_resolver_denied|auth_admin_required|auth_internal_failed"',
            'event=~"auth_failure"'
          )
          .replace(
            '{app="fishing-assistant"} |= "Usage service ingest request failed" [10m]',
            '{app="fishing-assistant"} |= "Usage request failed" [10m]'
          )
          .replace(
            '{app="fishing-assistant"} |= "knowledge_access_refresh_job_failed" [10m]',
            '{app="fishing-assistant"} |= "knowledge_access_job_failed" [10m]'
          )
          .replace(
            '{app="fishing-assistant"} |= "knowledge_access_chunk_marked_stale" [10m]',
            '{app="fishing-assistant"} |= "knowledge_chunk_marked_stale" [10m]'
          )
          .replace(
            '{app="fishing-assistant"} |= "knowledge_access_mismatch_detected" [10m]',
            '{app="fishing-assistant"} |= "knowledge_mismatch_detected" [10m]'
          )
          .replace(
            '{app="fishing-assistant"} |= "knowledge_source_url_rejected" [10m]',
            '{app="fishing-assistant"} |= "source_url_rejected" [10m]'
          )
          .replace(
            '{app="fishing-assistant"} |= "knowledge_rag_candidate_excluded" [10m]',
            '{app="fishing-assistant"} |= "rag_candidate_excluded" [10m]'
          ),
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'scripts/observability/grafana/alert-rules.yml must include the exact PROD user-service no-logs LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact user-service down LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact auth resolver failure LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact auth failure spike LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact usage-ingest failure LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact Knowledge Base access-refresh failed-jobs LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact Knowledge Base access stale-chunks LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact Knowledge Base access revision-mismatch LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact Knowledge Base source-url rejection LogQL',
            'scripts/observability/grafana/alert-rules.yml must include the exact Knowledge Base RAG leak-guard exclusion LogQL',
          ])
        );
      }
    );
  });

  it('validates the actual webhook URL and secret placeholder fields', () => {
    withObservabilityFixture(
      {
        ...validFiles,
        'scripts/observability/grafana/contact-points.yml': `
apiVersion: 1
contactPoints:
  - orgId: 1
    name: fa-alert-router
    receivers:
      - uid: fa-alert-router-webhook
        type: webhook
        settings:
          url: https://alerts.example.com/grafana
          httpHeaderName1: X-FA-Alert-Secret
          httpHeaderValue1: real-token-1234567890abcdef
# \${FA_ALERT_ROUTER_WEBHOOK_URL}
# \${FA_ALERT_ROUTER_WEBHOOK_SECRET}
`,
      },
      (root) => {
        expect(validateObservabilityRepository(root)).toEqual(
          expect.arrayContaining([
            'Likely secret literal in scripts/observability/grafana/contact-points.yml',
            'scripts/observability/grafana/contact-points.yml must define a webhook contact point with placeholder URL and secret',
          ])
        );
      }
    );
  });

  it('requires the root test:observability script to run Node and Vitest observability coverage', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['test:observability']).toContain(
      'node --test scripts/observability/*.test.mjs'
    );
    expect(packageJson.scripts?.['test:observability']).toContain(
      'pnpm exec vitest run scripts/__tests__/verify-observability.test.ts'
    );
  });
});

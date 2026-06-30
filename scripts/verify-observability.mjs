#!/usr/bin/env node
/* eslint-disable no-console */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');

const requiredFiles = [
  '.codex/skills/grafana-logs/SKILL.md',
  '.codex/skills/grafana-logs/scripts/query-loki.mjs',
  '.codex/skills/grafana-logs/scripts/conversation-logs.mjs',
  'scripts/observability/grafana/alert-rules.yml',
  'scripts/observability/grafana/contact-points.yml',
  'scripts/observability/grafana/dashboard-fa-logs.json',
  'scripts/observability/grafana/notification-policies.yml',
  'scripts/observability/grafana/README.md',
  'scripts/observability/templates/fa-dev.alloy.tmpl',
  'scripts/observability/templates/fa-prod.alloy.tmpl',
];

const grafanaLokiReadEnvNames = [
  'FA_GRAFANA_LOKI_READ_URL',
  'FA_GRAFANA_LOKI_READ_USERNAME',
  'FA_GRAFANA_LOKI_READ_TOKEN',
];

const forbiddenHostLocalLogCommands = [
  { name: 'pm2 logs', pattern: /\bpm2\s+logs\b/i },
  { name: 'docker logs', pattern: /\bdocker\s+logs\b/i },
  { name: 'journalctl', pattern: /\bjournalctl\b/i },
  { name: 'ssh', pattern: /(^|[\s`'"])ssh(?:\s|$)/i },
];

const readSecretDeployEnvFiles = ['scripts/hetzner/load-observability-env.sh'];

const readSecretServiceFiles = [
  'scripts/hetzner/fa-alert-router.service',
  'scripts/dev-host/fa-alert-router.service',
  'scripts/observability/fa-alloy.service',
  'scripts/observability/fa-alert-router.service',
];

const readSecretProvisioningFiles = ['terraform/gcp-data-plane/main.tf'];

const readSecretForbiddenSurfaceDirectories = [
  'scripts/deploy',
  'scripts/hetzner',
  'scripts/dev-host',
  'scripts/observability',
  'terraform',
];

const requiredAlertNames = [
  'FA Backend Error Logs',
  'FA Nginx 5xx',
  'FA Usage Ingest Failure',
  'FA Deploy Failure',
  'FA No Logs Received',
  'FA User Service No Logs',
  'FA User Service Down',
  'FA Auth Resolver Failures',
  'FA Auth Failure Spike',
  'FAKnowledgeAccessRefreshJobsFailed',
  'FAKnowledgeAccessChunksStale',
  'FAKnowledgeAccessRevisionMismatch',
  'FAKnowledgeSourceUrlRejected',
  'FAKnowledgeRagLeakGuardExcludedCandidates',
];

const requiredKnowledgeAccessLogEvents = [
  'knowledge_access_refresh_job_claimed',
  'knowledge_access_refresh_job_succeeded',
  'knowledge_access_refresh_job_failed',
  'knowledge_access_chunk_marked_stale',
  'knowledge_access_mismatch_detected',
  'knowledge_source_url_rejected',
  'knowledge_rag_candidate_excluded',
];

const requiredDevPm2LogTargets = [
  { service: 'chat-service', glob: 'fa-chat-service-*.log' },
  { service: 'knowledge-service', glob: 'fa-knowledge-service-*.log' },
  { service: 'llm-usage-service', glob: 'fa-llm-usage-service-*.log' },
  { service: 'user-service', glob: 'fa-user-service-*.log' },
  { service: 'web', glob: 'fa-web-*.log' },
];

const requiredExactAlertQueries = [
  {
    name: 'the exact PROD user-service no-logs LogQL',
    query:
      '{app="fishing-assistant", source="docker", service="services"} | json service_name="service" | service_name="user-service" [15m]',
  },
  {
    name: 'the exact user-service down LogQL',
    query:
      '{app="fishing-assistant", source="nginx"} |= "/api/users/health" |~ "\\\\s5[0-9]{2}\\\\s" [5m]',
  },
  {
    name: 'the exact auth resolver failure LogQL',
    query: '{app="fishing-assistant"} | json | event="auth_resolver_unavailable" [5m]',
  },
  {
    name: 'the exact auth failure spike LogQL',
    query:
      '{app="fishing-assistant"} | json | event=~"auth_bearer_invalid|auth_jwt_invalid|auth_resolver_denied|auth_admin_required|auth_internal_failed" [5m]',
  },
  {
    name: 'the exact usage-ingest failure LogQL',
    query: '{app="fishing-assistant"} |= "Usage service ingest request failed" [10m]',
  },
  {
    name: 'the exact Knowledge Base access-refresh failed-jobs LogQL',
    query: '{app="fishing-assistant"} |= "knowledge_access_refresh_job_failed" [10m]',
  },
  {
    name: 'the exact Knowledge Base access stale-chunks LogQL',
    query: '{app="fishing-assistant"} |= "knowledge_access_chunk_marked_stale" [10m]',
  },
  {
    name: 'the exact Knowledge Base access revision-mismatch LogQL',
    query: '{app="fishing-assistant"} |= "knowledge_access_mismatch_detected" [10m]',
  },
  {
    name: 'the exact Knowledge Base source-url rejection LogQL',
    query: '{app="fishing-assistant"} |= "knowledge_source_url_rejected" [10m]',
  },
  {
    name: 'the exact Knowledge Base RAG leak-guard exclusion LogQL',
    query: '{app="fishing-assistant"} |= "knowledge_rag_candidate_excluded" [10m]',
  },
];

/**
 * @param {string} root
 * @param {string} filePath
 * @returns {string}
 */
function toRelativePath(root, filePath) {
  return relative(root, filePath).split(sep).join('/');
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @returns {string | undefined}
 */
function readOptionalFile(root, relativePath) {
  const filePath = resolve(root, relativePath);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listObservabilityFiles(root) {
  const baseDirectory = resolve(root, 'scripts/observability');
  /** @type {string[]} */
  const files = [];

  if (!existsSync(baseDirectory)) {
    return files;
  }

  /**
   * @param {string} directory
   * @returns {void}
   */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || statSync(entryPath).size > 1_000_000) {
        continue;
      }

      const relativePath = toRelativePath(root, entryPath);
      if (
        relativePath.startsWith('scripts/observability/grafana/') ||
        /^scripts\/observability\/templates\/fa-(?:dev|prod)\.alloy\.tmpl$/.test(relativePath)
      ) {
        files.push(relativePath);
      }
    }
  }

  visit(baseDirectory);
  return files;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listGrafanaLogsSkillFiles(root) {
  const baseDirectory = resolve(root, '.codex/skills/grafana-logs');
  /** @type {string[]} */
  const files = [];

  if (!existsSync(baseDirectory)) {
    return files;
  }

  /**
   * @param {string} directory
   * @returns {void}
   */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || statSync(entryPath).size > 1_000_000) {
        continue;
      }

      const relativePath = toRelativePath(root, entryPath);
      if (relativePath.endsWith('.test.mjs')) {
        continue;
      }

      files.push(relativePath);
    }
  }

  visit(baseDirectory);
  return files;
}

/**
 * @param {string} root
 * @param {string[]} relativeDirectories
 * @returns {string[]}
 */
function listFilesUnderDirectories(root, relativeDirectories) {
  /** @type {string[]} */
  const files = [];

  /**
   * @param {string} directory
   * @returns {void}
   */
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || statSync(entryPath).size > 1_000_000) {
        continue;
      }

      files.push(toRelativePath(root, entryPath));
    }
  }

  for (const relativeDirectory of relativeDirectories) {
    const directory = resolve(root, relativeDirectory);
    if (existsSync(directory)) {
      visit(directory);
    }
  }

  return files;
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasLikelySecretLiteral(source) {
  const withoutPlaceholders = source.replace(/\$\{FA_[A-Z0-9_]+\}/g, '');
  return (
    /https?:\/\/(?!127\.0\.0\.1|localhost|example\.invalid)/i.test(withoutPlaceholders) ||
    /\b(?:token|secret|password|authorization)\s*:\s*['"]?[A-Za-z0-9_.-]{12,}/i.test(
      withoutPlaceholders
    )
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasWebhookContactPointPlaceholder(source) {
  return (
    /\btype:\s*webhook\b/.test(source) &&
    /^\s*url:\s*\$\{FA_ALERT_ROUTER_WEBHOOK_URL\}\s*$/m.test(source) &&
    /^\s*httpHeaderName1:\s*X-FA-Alert-Secret\s*$/m.test(source) &&
    /^\s*httpHeaderValue1:\s*\$\{FA_ALERT_ROUTER_WEBHOOK_SECRET\}\s*$/m.test(source) &&
    !/^\s*url:\s*https?:\/\//im.test(source)
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeForSearch(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasFaLogsDashboard(source) {
  try {
    const dashboard = JSON.parse(source);
    /** @type {string[]} */
    const strings = [];
    /**
     * @param {unknown} value
     * @returns {void}
     */
    function collectStrings(value) {
      if (typeof value === 'string') {
        strings.push(value);
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          collectStrings(item);
        }
        return;
      }

      if (value !== null && typeof value === 'object') {
        for (const item of Object.values(value)) {
          collectStrings(item);
        }
      }
    }

    collectStrings(dashboard);
    const content = strings.join('\n');
    return (
      dashboard?.uid === 'fa-logs' &&
      dashboard?.title === 'Fishing Assistant Logs' &&
      content.includes('Live FA Logs') &&
      content.includes('Latest FA Errors') &&
      content.includes('FA Log Volume by Service') &&
      content.includes('FA Auth Resolver Failures') &&
      content.includes('FA Auth Failure Events') &&
      content.includes('FA User Service Health 5xx') &&
      content.includes('FA Usage Ingest Failures') &&
      content.includes('FA Knowledge Access Monitors') &&
      content.includes('{app="fishing-assistant"') &&
      content.includes('env=~"$env"') &&
      content.includes('service=~"$service"') &&
      content.includes('source=~"$source"') &&
      content.includes('grafanacloud-logs')
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRequiredLokiLabels(source) {
  return (
    /sum by \(service, env\)\s*\(\s*count_over_time\(\{app="fishing-assistant"\}\s*\|\s*json\s*\|\s*level="error"/.test(
      source
    ) &&
    /sum by \(service, env\)\s*\(\s*count_over_time\(\{app="fishing-assistant", source="nginx"\}/.test(
      source
    ) &&
    /sum by \(service, env\)\s*\(\s*count_over_time\(\{app="fishing-assistant"\}\s*\|=\s*"Usage service ingest request failed"/.test(
      source
    ) &&
    /sum by \(service, env\)\s*\(\s*count_over_time\(\{app="fishing-assistant", service="deploy", source="journald"\}/.test(
      source
    )
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasPerServiceNoLogsAlert(source) {
  return /sum by \(service, env\)\s*\(\s*absent_over_time\(\{app="fishing-assistant", service=~"\.\+"\}\[15m\]\)\s*\)/.test(
    source
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasUnsafeAlloyScrape(source) {
  return (
    /\bpm2\s+jlist\b/i.test(source) ||
    /\bprocess\.env\b/i.test(source) ||
    /\benv\s+dump/i.test(source)
  );
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function getFileSourceBlocks(source) {
  const starts = [...source.matchAll(/(^|\n)loki\.source\.file\s+"[^"]+"\s*\{/g)].map(
    (match) => match.index ?? 0
  );
  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? source.length;
    return source.slice(start, nextStart);
  });
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasGlobbedFileSourceWithoutFileMatch(source) {
  return getFileSourceBlocks(source).some(
    (block) =>
      /__path__\s*=\s*"[^"]*[*{]/.test(block) &&
      !/file_match\s*\{[\s\S]*?enabled\s*=\s*true/.test(block)
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasFaDockerDiscovery(source) {
  return (
    /discovery\.docker\s+"fa_services"\s*\{[\s\S]*?host\s*=\s*"unix:\/\/\/var\/run\/docker\.sock"/.test(
      source
    ) &&
    /discovery\.relabel\s+"fa_services"\s*\{[\s\S]*?targets\s*=\s*discovery\.docker\.fa_services\.targets/.test(
      source
    ) &&
    /source_labels\s*=\s*\[\s*"__meta_docker_container_name"\s*\]/.test(source) &&
    /regex\s*=\s*"\/fa-services"/.test(source) &&
    /action\s*=\s*"keep"/.test(source) &&
    /loki\.source\.docker\s+"fa_services"\s*\{[\s\S]*?targets\s*=\s*discovery\.relabel\.fa_services\.output/.test(
      source
    )
  );
}

/**
 * @param {string} source
 * @returns {boolean}
 */
function hasRequiredDevPm2Targets(source) {
  return requiredDevPm2LogTargets.every(
    ({ service, glob }) => source.includes(glob) && source.includes(`service = "${service}"`)
  );
}

/**
 * @param {string | undefined} source
 * @returns {boolean}
 */
function hasGrafanaLokiReadRunbook(source) {
  if (source === undefined) {
    return false;
  }

  return (
    source.includes('Read Access For Incident Debugging') &&
    grafanaLokiReadEnvNames.every((name) => source.includes(name)) &&
    source.includes('logs:read') &&
    source.includes('{app="fishing-assistant", env=~"dev|prod"}')
  );
}

/**
 * @param {string} root
 * @param {string[]} errors
 * @returns {void}
 */
function validateGrafanaLokiReadAccess(root, errors) {
  const runbookPath = 'docs/operations/fa-observability-runbook.md';
  const runbook = readOptionalFile(root, runbookPath);
  if (!hasGrafanaLokiReadRunbook(runbook)) {
    errors.push(`${runbookPath} must document Grafana Loki read access for incident debugging`);
  }

  for (const relativePath of ['.env.example', '.env.dev.example', '.env.prod.example']) {
    const source = readOptionalFile(root, relativePath);
    for (const envName of grafanaLokiReadEnvNames) {
      if (source === undefined || !source.includes(envName)) {
        errors.push(`${relativePath} must document ${envName}`);
      }
    }
  }

  for (const relativePath of listGrafanaLogsSkillFiles(root)) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    for (const { name, pattern } of forbiddenHostLocalLogCommands) {
      if (pattern.test(source)) {
        errors.push(`${relativePath} must not include host-local log fallback command ${name}`);
      }
    }
  }

  for (const relativePath of readSecretDeployEnvFiles) {
    const source = readOptionalFile(root, relativePath);
    if (source === undefined) {
      continue;
    }

    for (const envName of grafanaLokiReadEnvNames) {
      if (source.includes(envName)) {
        errors.push(`${relativePath} must not render ${envName} into deployed observability env`);
      }
    }
  }

  for (const relativePath of readSecretServiceFiles) {
    const source = readOptionalFile(root, relativePath);
    if (source === undefined) {
      continue;
    }

    for (const envName of grafanaLokiReadEnvNames) {
      if (source.includes(envName)) {
        errors.push(`${relativePath} must not expose ${envName} to deployed services`);
      }
    }
  }

  for (const relativePath of readSecretProvisioningFiles) {
    const source = readOptionalFile(root, relativePath);
    if (source === undefined) {
      continue;
    }

    for (const envName of grafanaLokiReadEnvNames) {
      if (source.includes(envName)) {
        errors.push(
          `${relativePath} must not grant deployed runtime/provisioning access to ${envName}`
        );
      }
    }
  }

  for (const relativePath of listFilesUnderDirectories(
    root,
    readSecretForbiddenSurfaceDirectories
  )) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');
    for (const envName of grafanaLokiReadEnvNames) {
      if (source.includes(envName)) {
        errors.push(
          `${relativePath} must not reference ${envName} in deploy/runtime/provisioning surfaces`
        );
      }
    }
  }
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function validateObservabilityRepository(root = repoRoot) {
  /** @type {string[]} */
  const errors = [];

  for (const relativePath of requiredFiles) {
    if (!existsSync(resolve(root, relativePath))) {
      errors.push(`Missing observability artifact: ${relativePath}`);
    }
  }

  for (const relativePath of listObservabilityFiles(root)) {
    const source = readFileSync(resolve(root, relativePath), 'utf8');

    if (source.includes('FA_SENTRY')) {
      errors.push(`Forbidden Sentry reference in ${relativePath}`);
    }

    if (hasLikelySecretLiteral(source)) {
      errors.push(`Likely secret literal in ${relativePath}`);
    }

    if (
      /^scripts\/observability\/templates\/fa-(?:dev|prod)\.alloy\.tmpl$/.test(relativePath) &&
      hasUnsafeAlloyScrape(source)
    ) {
      errors.push(`${relativePath} must not scrape PM2 jlist output or environment dumps`);
    }

    if (
      /^scripts\/observability\/templates\/fa-(?:dev|prod)\.alloy\.tmpl$/.test(relativePath) &&
      hasGlobbedFileSourceWithoutFileMatch(source)
    ) {
      errors.push(`${relativePath} must enable Alloy file_match for globbed file sources`);
    }

    if (
      relativePath === 'scripts/observability/templates/fa-prod.alloy.tmpl' &&
      source.includes('loki.source.docker') &&
      !hasFaDockerDiscovery(source)
    ) {
      errors.push(
        `${relativePath} must discover and keep the fa-services Docker container before loki.source.docker`
      );
    }

    if (
      relativePath === 'scripts/observability/templates/fa-dev.alloy.tmpl' &&
      !hasRequiredDevPm2Targets(source)
    ) {
      for (const { service } of requiredDevPm2LogTargets) {
        if (!source.includes(`service = "${service}"`)) {
          errors.push(`${relativePath} must collect PM2 logs for service ${service}`);
        }
      }
    }
  }

  const alertRulesPath = 'scripts/observability/grafana/alert-rules.yml';
  const alertRules = readOptionalFile(root, alertRulesPath);
  if (alertRules !== undefined) {
    for (const alertName of requiredAlertNames) {
      if (!alertRules.includes(alertName)) {
        errors.push(`${alertRulesPath} must include alert ${alertName}`);
      }
    }

    for (const eventName of requiredKnowledgeAccessLogEvents) {
      if (!alertRules.includes(eventName)) {
        errors.push(`${alertRulesPath} must include log event ${eventName}`);
      }
    }

    if (!alertRules.includes('count_over_time')) {
      errors.push(`${alertRulesPath} must include count_over_time LogQL`);
    }

    if (!hasRequiredLokiLabels(alertRules)) {
      errors.push(`${alertRulesPath} must query Loki labels app, env, and service`);
    }

    if (!alertRules.includes('source="nginx"') || !alertRules.includes('" 5"')) {
      errors.push(`${alertRulesPath} must include nginx 5xx LogQL`);
    }

    if (!alertRules.includes('Usage service ingest request failed')) {
      errors.push(`${alertRulesPath} must include usage-ingest failure LogQL`);
    }

    if (!alertRules.includes('service="deploy"') || !alertRules.includes('source="journald"')) {
      errors.push(`${alertRulesPath} must include deploy failure LogQL`);
    }

    if (!alertRules.includes('absent_over_time')) {
      errors.push(`${alertRulesPath} must include no-logs-received LogQL`);
    }

    if (!hasPerServiceNoLogsAlert(alertRules)) {
      errors.push(`${alertRulesPath} must include per-service no-logs-received LogQL`);
    }

    const normalizedAlertRules = normalizeForSearch(alertRules);
    for (const { name, query } of requiredExactAlertQueries) {
      if (!normalizedAlertRules.includes(normalizeForSearch(query))) {
        errors.push(`${alertRulesPath} must include ${name}`);
      }
    }
  }

  const contactPointsPath = 'scripts/observability/grafana/contact-points.yml';
  const contactPoints = readOptionalFile(root, contactPointsPath);
  if (contactPoints !== undefined && !hasWebhookContactPointPlaceholder(contactPoints)) {
    errors.push(
      `${contactPointsPath} must define a webhook contact point with placeholder URL and secret`
    );
  }

  const dashboardPath = 'scripts/observability/grafana/dashboard-fa-logs.json';
  const dashboard = readOptionalFile(root, dashboardPath);
  if (dashboard !== undefined && !hasFaLogsDashboard(dashboard)) {
    errors.push(
      `${dashboardPath} must define the FA logs dashboard with app/env/service/source LogQL`
    );
  }

  validateGrafanaLokiReadAccess(root, errors);

  return errors;
}

/**
 * @param {string[]} argv
 * @returns {{ root: string }}
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let root = repoRoot;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--root') {
      const next = args[index + 1];
      if (typeof next !== 'string' || next.length === 0 || next.startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }

  return { root };
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const errors = validateObservabilityRepository(root);

    if (errors.length > 0) {
      console.error('Observability verification failed:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log('Observability templates verified.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Observability verification failed: ${message}`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { validateObservabilityRepository };

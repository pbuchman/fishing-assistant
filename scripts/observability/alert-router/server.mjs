import { createServer } from 'node:http';

import { isValidAlertSecret } from './auth.mjs';
import { createDedupeStore } from './dedupe-store.mjs';
import { redactPayload } from './redaction.mjs';

const maxBodyBytes = 1024 * 1024;
const maxEmbeddedPayloadChars = 12_000;
const defaultRunbookUrl =
  'https://github.com/pbuchman/fishing-assistant/blob/main/docs/operations/fa-observability-runbook.md';
const sensitiveInlinePattern = /(?:token|secret|authorization|api[_-]?key|password)=([^&\s"`]+)/gi;

/**
 * @typedef {{ status?: string; fingerprint?: string; labels?: Record<string, unknown>; annotations?: Record<string, unknown>; generatorURL?: string }} GrafanaAlert
 */

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} payload
 * @returns {void}
 */
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<string>}
 */
async function readRequestBody(request) {
  /** @type {Buffer[]} */
  const chunks = [];
  let length = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBodyBytes) {
      throw new Error('request body too large');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {Record<string, unknown>} values
 * @param {string} key
 * @returns {string}
 */
function stringValue(values, key) {
  const value = values[key];
  return typeof value === 'string' && value.length > 0 ? value : '';
}

/**
 * @param {GrafanaAlert} alert
 * @param {number} index
 * @returns {string}
 */
function alertFingerprint(alert, index) {
  if (typeof alert.fingerprint === 'string' && alert.fingerprint.length > 0) {
    return alert.fingerprint;
  }

  const labels = asRecord(alert.labels);
  return [
    stringValue(labels, 'alertname'),
    stringValue(labels, 'service'),
    stringValue(labels, 'env'),
    String(index),
  ].join(':');
}

/**
 * @param {GrafanaAlert} alert
 * @returns {string}
 */
function issueTitle(alert) {
  const labels = asRecord(alert.labels);
  const alertName = stringValue(labels, 'alertname') || 'Grafana alert';
  const service = stringValue(labels, 'service') || 'unknown-service';
  const env = stringValue(labels, 'env') || 'unknown-env';
  const status = alert.status ?? 'firing';
  return `[FA][${status}] ${alertName} (${service}/${env})`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function inlineCode(value) {
  return `\`${String(value).replaceAll('`', "'")}\``;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeInlineValue(value) {
  return value.replace(sensitiveInlinePattern, (match) => {
    const separator = match.includes('=') ? '=' : '';
    const key = match.split('=')[0] ?? 'secret';
    return `${key}${separator}[REDACTED]`;
  });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function redactedStringValue(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }

  return sanitizeInlineValue(value);
}

/**
 * @param {unknown} payload
 * @returns {string}
 */
function redactedPayloadJson(payload) {
  const redacted = JSON.stringify(redactPayload(payload), null, 2);
  const sanitized = sanitizeInlineValue(redacted);

  if (sanitized.length <= maxEmbeddedPayloadChars) {
    return sanitized;
  }

  return `${sanitized.slice(0, maxEmbeddedPayloadChars)}\n[TRUNCATED]`;
}

/**
 * @param {GrafanaAlert} alert
 * @param {unknown} originalPayload
 * @param {{ repository: string; grafanaInstanceUrl: string; releaseSha?: string }} context
 * @returns {string}
 */
function issueBody(alert, originalPayload, context) {
  const labels = asRecord(alert.labels);
  const annotations = asRecord(alert.annotations);
  const status = alert.status ?? 'firing';
  const alertName = stringValue(labels, 'alertname') || 'Grafana alert';
  const severity = stringValue(labels, 'severity') || 'unknown';
  const service = stringValue(labels, 'service') || 'unknown';
  const env = stringValue(labels, 'env') || 'unknown';
  const ruleUrl =
    (typeof alert.generatorURL === 'string' && alert.generatorURL.length > 0
      ? alert.generatorURL
      : stringValue(annotations, 'grafana_rule_url')) || context.grafanaInstanceUrl;
  const lokiQuery = redactedStringValue(
    stringValue(annotations, 'loki_query') || stringValue(annotations, 'query')
  );
  const runbook = redactedStringValue(stringValue(annotations, 'runbook_url')) || defaultRunbookUrl;
  const deploymentSha =
    redactedStringValue(stringValue(labels, 'sha')) || context.releaseSha || 'unknown';
  const redactedPayload = redactedPayloadJson(originalPayload);

  return [
    `Alert: ${alertName}`,
    `Status: ${status}`,
    `Severity: ${severity}`,
    `Service: ${service}`,
    `Environment: ${env}`,
    `Grafana: ${redactedStringValue(ruleUrl)}`,
    lokiQuery.length > 0 ? `Loki query: ${inlineCode(lokiQuery)}` : 'Loki query: not provided',
    `Runbook: ${runbook}`,
    `Deployment SHA: ${deploymentSha}`,
    '',
    'This issue was created for investigation. It did not modify code or deploy.',
    '',
    '<details><summary>Redacted alert payload</summary>',
    '',
    '```json',
    redactedPayload,
    '```',
    '',
    '</details>',
  ].join('\n');
}

/**
 * @param {GrafanaAlert} alert
 * @param {{ repository: string; grafanaInstanceUrl: string; releaseSha?: string }} context
 * @returns {string}
 */
function resolvedCommentBody(alert, context) {
  const labels = asRecord(alert.labels);
  const alertName = stringValue(labels, 'alertname') || 'Grafana alert';
  const service = stringValue(labels, 'service') || 'unknown';
  const env = stringValue(labels, 'env') || 'unknown';
  return [
    `Grafana reported this alert resolved: ${alertName}`,
    `Service: ${service}`,
    `Environment: ${env}`,
    `Grafana: ${typeof alert.generatorURL === 'string' ? alert.generatorURL : context.grafanaInstanceUrl}`,
  ].join('\n');
}

/**
 * @param {unknown} payload
 * @returns {GrafanaAlert[]}
 */
function alertsFromPayload(payload) {
  const record = asRecord(payload);
  const alerts = record['alerts'];
  if (Array.isArray(alerts)) {
    return alerts.map((alert) => asRecord(alert));
  }

  return [];
}

/**
 * @param {{ secret: string; repository: string; grafanaInstanceUrl: string; releaseSha?: string; githubClient: { createIssue(input: { title: string; body: string; labels?: string[] }): Promise<{ number: number; html_url?: string }>; commentOnIssue(input: { issueNumber: number; body: string }): Promise<unknown> }; dedupeStore?: ReturnType<typeof createDedupeStore> }} options
 * @returns {import('node:http').Server}
 */
export function createAlertRouterServer(options) {
  const dedupeStore = options.dedupeStore ?? createDedupeStore();
  /** @type {{ repository: string; grafanaInstanceUrl: string; releaseSha?: string }} */
  const context = {
    repository: options.repository,
    grafanaInstanceUrl: options.grafanaInstanceUrl,
  };
  if (options.releaseSha !== undefined) {
    context.releaseSha = options.releaseSha;
  }

  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { ok: true, service: 'fa-alert-router' });
        return;
      }

      if (request.method !== 'POST' || request.url !== '/alerts/grafana') {
        sendJson(response, 404, { error: 'not found' });
        return;
      }

      if (!isValidAlertSecret(request.headers, options.secret)) {
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }

      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody);
      const alerts = alertsFromPayload(payload);

      let created = 0;
      let deduped = 0;
      let commented = 0;

      for (const [index, alert] of alerts.entries()) {
        const fingerprint = alertFingerprint(alert, index);
        if (alert.status === 'resolved') {
          const existing = dedupeStore.get(fingerprint);
          if (existing !== undefined) {
            await options.githubClient.commentOnIssue({
              issueNumber: existing.issueNumber,
              body: resolvedCommentBody(alert, context),
            });
            commented += 1;
          } else {
            deduped += 1;
          }
          continue;
        }

        if (!dedupeStore.shouldCreateActive(fingerprint)) {
          dedupeStore.rememberDuplicate(fingerprint);
          deduped += 1;
          continue;
        }

        const issue = await options.githubClient.createIssue({
          title: issueTitle(alert),
          body: issueBody(alert, payload, context),
          labels: ['observability', 'investigation', 'grafana-alert'],
        });
        dedupeStore.rememberActive(fingerprint, issue);
        created += 1;
      }

      sendJson(response, 202, { ok: true, created, deduped, commented });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, message === 'request body too large' ? 413 : 400, { error: message });
    }
  });
}

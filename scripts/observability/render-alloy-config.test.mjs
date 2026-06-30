import test from 'node:test';
import assert from 'node:assert/strict';

import { renderAlloyConfig } from './render-alloy-config.mjs';

/**
 * @param {string} source
 * @returns {void}
 */
function assertRequiredLabels(source) {
  for (const label of ['app', 'env', 'host', 'service', 'source']) {
    assert.match(source, new RegExp(`${label}\\s*=`));
  }
}

test('renders DEV PM2 file and journald sources with required labels', () => {
  const rendered = renderAlloyConfig({
    environment: 'dev',
    host: 'dev-host',
    pm2LogDir: '/srv/fa-pm2/logs',
  });

  assert.match(rendered, /loki\.source\.file "pm2"/);
  assert.match(rendered, /\/srv\/fa-pm2\/logs\/fa-chat-service-\*\.log/);
  assert.match(rendered, /_SYSTEMD_UNIT=fa-webhook-handler\.service/);
  assert.match(rendered, /_SYSTEMD_UNIT=fa-alert-router\.service/);
  assert.match(rendered, /env = "dev"/);
  assert.match(rendered, /host = "dev-host"/);
  assertRequiredLabels(rendered);
});

test('renders PROD Docker and nginx sources with required labels', () => {
  const rendered = renderAlloyConfig({
    environment: 'prod',
    host: 'hetzner-prod',
    sha: 'abc123',
  });

  assert.match(rendered, /loki\.source\.docker "fa_services"/);
  assert.match(rendered, /discovery\.relabel "fa_services"/);
  assert.match(rendered, /regex = "\/fa-services"/);
  assert.match(rendered, /loki\.source\.file "nginx"/);
  assert.match(rendered, /\/var\/log\/nginx\/\*\.log/);
  assert.match(rendered, /_SYSTEMD_UNIT=fa-alert-router\.service/);
  assert.match(rendered, /_SYSTEMD_UNIT=fa-deploy\.service/);
  assert.match(rendered, /env = "prod"/);
  assert.match(rendered, /host = "hetzner-prod"/);
  assert.match(rendered, /sha = "abc123"/);
  assertRequiredLabels(rendered);
});

test('keeps Grafana credentials as runtime env references', () => {
  const rendered = renderAlloyConfig({
    environment: 'dev',
    host: 'dev-host',
  });

  assert.match(rendered, /env\("FA_GRAFANA_LOKI_URL"\)/);
  assert.match(rendered, /env\("FA_GRAFANA_LOKI_USERNAME"\)/);
  assert.match(rendered, /env\("FA_GRAFANA_LOKI_TOKEN"\)/);
  assert.doesNotMatch(rendered, /grafana-token-value/);
  assert.doesNotMatch(rendered, /grafana-user-value/);
});

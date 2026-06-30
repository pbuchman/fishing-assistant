# FA Observability Runbook

Fishing Assistant uses Grafana Cloud Loki for central logs, Grafana
Alerting for alert rules, Grafana Alloy on hosts for collection, and
`fa-alert-router` for safe alert automation.

The alert-router creates GitHub investigation issues only. It does not edit
code, run Codex, deploy, or mutate production state.

## Grafana Cloud Setup

Checklist:

- Create or select the FA Grafana Cloud stack.
- Create a Loki write token for Alloy.
- Record the Loki push URL, username, and token.
- Record the Grafana instance URL.
- Record the Loki datasource UID used by alert rules.
- Configure alert rules from `scripts/observability/grafana/alert-rules.yml`.
- Configure the webhook contact point from
  `scripts/observability/grafana/contact-points.yml`.
- Configure notification routing from
  `scripts/observability/grafana/notification-policies.yml`.

Grafana Cloud does not consume these files directly. Treat the checked-in
Grafana files as source templates for manual import, API provisioning, or a
future Terraform workflow.

## Secrets And Values

DEV values live in ignored local env files, usually `/etc/fa/observability.env`
for Alloy and alert-router plus `.env.dev.local` for local app/runtime work.

PROD observability values are loaded from GCP Secret Manager by the Hetzner
deploy/provisioning path.

Secret values:

```text
FA_GRAFANA_LOKI_URL
FA_GRAFANA_LOKI_USERNAME
FA_GRAFANA_LOKI_TOKEN
FA_ALERT_ROUTER_WEBHOOK_SECRET
FA_ALERT_ROUTER_GITHUB_TOKEN
```

Non-secret values:

```text
FA_GRAFANA_INSTANCE_URL
FA_GRAFANA_LOKI_DATASOURCE_UID
FA_ALERT_ROUTER_WEBHOOK_URL
FA_ALERT_ROUTER_GITHUB_REPOSITORY=pbuchman/fishing-assistant
FA_LOG_LEVEL=info
```

The Grafana webhook contact point must call `/alerts/grafana` with:

```text
X-FA-Alert-Secret: <FA_ALERT_ROUTER_WEBHOOK_SECRET>
```

## Read Access For Incident Debugging

Codex and trusted operators may query central Grafana Cloud Loki directly for
incident debugging with the checked-in `grafana-logs` skill. This access is
read-only and separate from the Alloy write triplet.

Read credential names:

```text
FA_GRAFANA_LOKI_READ_URL
FA_GRAFANA_LOKI_READ_USERNAME
FA_GRAFANA_LOKI_READ_TOKEN
```

Create the Grafana Cloud token with Loki `logs:read` only. Where Grafana Cloud
LBAC is available, constrain it to the FA labels:

```logql
{app="fishing-assistant", env=~"dev|prod"}
```

The read triplet is operator/Codex-only. Do not render it into
`/etc/fa/observability.env`, systemd units, Alloy configs, alert-router
runtime env, deployed app runtime env, or deployed provisioner/runtime GCP
identities. PROD and DEV services only need the existing write triplet and
alert-router secrets.

Where the read values belong:

- Grafana Cloud stack: a Loki token/access policy with `logs:read`, and LBAC
  `{app="fishing-assistant", env=~"dev|prod"}` where supported.
- GCP Secret Manager project from `FA_GCP_PROJECT_ID`: secrets named
  `FA_GRAFANA_LOKI_READ_URL`, `FA_GRAFANA_LOKI_READ_USERNAME`, and
  `FA_GRAFANA_LOKI_READ_TOKEN`, each with a latest version.
- Trusted local operator/Codex shell: either all three env vars loaded directly,
  or `FA_GCP_ADMIN_KEY_FILE` set to the local admin key so the helper can read
  the pinned Secret Manager fallback.

Presence-only checks from a trusted local shell:

```bash
direnv exec . node -e "for (const name of ['FA_GRAFANA_LOKI_READ_URL','FA_GRAFANA_LOKI_READ_USERNAME','FA_GRAFANA_LOKI_READ_TOKEN']) console.log(name + '=' + (process.env[name] ? 'present' : 'missing'))"

CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$FA_GCP_ADMIN_KEY_FILE" \
  gcloud --project "$FA_GCP_PROJECT_ID" secrets list \
  --filter='name~FA_GRAFANA_LOKI_READ' \
  --format='value(name)'
```

Smoke read access from a trusted local shell:

```bash
node .codex/skills/grafana-logs/scripts/query-loki.mjs \
  --env dev \
  --since 15m \
  --limit 5
```

Expected: the helper reports stream and entry counts plus bounded redacted log
lines, or a clear no-results/auth failure. It must not print raw prompts,
provider payloads, Knowledge Base snippets, authorization headers, or Grafana
tokens.

Rotate the read token independently from the Alloy write token:

1. Create a replacement Grafana Cloud token with `logs:read` and the same LBAC
   constraint.
2. Update the ignored local env file or the three GCP Secret Manager values
   used by Codex/operator shells.
3. Re-run the smoke query above for `dev` and `prod` as needed.
4. Revoke the old read token after successful smoke checks.

## Install On DEV

Create `/etc/fa/observability.env` with the Loki and alert-router values, then
run:

```bash
sudo scripts/observability/install-alloy.sh --environment dev --host dev-host
```

After `scripts/observability/alert-router.mjs` is present in the deployed
clone, install the router too:

```bash
sudo scripts/observability/install-alloy.sh --environment dev --host dev-host --with-alert-router
```

The DEV public Caddy site lives outside this repository. Copy or merge
`scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile`
into the host-level FA Caddy site. The snippet must be placed before the
frontend fallback so `/healthz` returns `ok` at the edge and `/alerts/grafana`
proxies to `127.0.0.1:9002`.

## DEV Smoke

Load the local observability values without printing secrets:

```bash
set -a
. /etc/fa/observability.env
set +a
```

Verify local services:

```bash
sudo systemctl status fa-alloy --no-pager
sudo systemctl status fa-alert-router --no-pager
curl --fail --silent --show-error http://127.0.0.1:9002/health
```

Verify public DEV routes:

```bash
curl --fail --silent --show-error https://dev.fishing-assistant.online/healthz
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  -H "Content-Type: application/json" \
  --data '{"status":"resolved","alerts":[]}' \
  https://dev.fishing-assistant.online/alerts/grafana
curl --fail --silent --show-error \
  -H "X-FA-Alert-Secret: ${FA_ALERT_ROUTER_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  --data '{"status":"resolved","alerts":[]}' \
  https://dev.fishing-assistant.online/alerts/grafana
```

Expected: `/healthz` returns `ok`, missing alert secret returns `401`, and the
configured secret returns accepted JSON with zero created alerts for the no-op
payload.

In Grafana Explore:

```logql
{app="fishing-assistant", env="dev"}
{app="fishing-assistant", env="dev", service="alert-router", source="journald"}
```

Expected: fresh DEV PM2, webhook, Alloy, or alert-router log lines appear.

## Install On PROD

GitHub Actions production deploy loads `/etc/fa/observability.env` from Secret
Manager and installs `fa-alloy` plus `fa-alert-router`.

For manual repair or rerun on the Hetzner host:

```bash
cd /opt/fishing-assistant/current
sudo FA_ENVIRONMENT=prod scripts/hetzner/load-observability-env.sh
sudo FA_ENVIRONMENT=prod scripts/hetzner/install-observability.sh --sha "$(git rev-parse HEAD)"
```

To include the alert-router systemd unit:

```bash
sudo FA_ENVIRONMENT=prod scripts/hetzner/install-observability.sh --sha "$(git rev-parse HEAD)" --with-alert-router
```

The PROD nginx config proxies exactly `/alerts/grafana` to `127.0.0.1:9002`.
It must not expose broader `/alerts/*` paths.

## PROD Smoke

Before rollout, verify checked-in PROD routing and observability assumptions:

```bash
pnpm run verify:prod-runtime
```

After applying PROD secrets and install scripts on the Hetzner host:

```bash
ssh "$FA_HETZNER_PROD_HOST" 'docker ps --filter name=fa-services && sudo systemctl status fa-alloy --no-pager'
ssh "$FA_HETZNER_PROD_HOST" 'sudo systemctl status fa-alert-router --no-pager'
ssh "$FA_HETZNER_PROD_HOST" 'sudo test -r /var/log/nginx/access.log && sudo test -r /var/log/nginx/error.log'
```

From a trusted shell with `FA_ALERT_ROUTER_WEBHOOK_SECRET` loaded:

```bash
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  --resolve "fishing-assistant.online:443:${FA_HETZNER_PROD_HOST}" \
  -H "Content-Type: application/json" \
  --data '{"status":"resolved","alerts":[]}' \
  https://fishing-assistant.online/alerts/grafana
curl --fail --silent --show-error \
  --resolve "fishing-assistant.online:443:${FA_HETZNER_PROD_HOST}" \
  -H "X-FA-Alert-Secret: ${FA_ALERT_ROUTER_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  --data '{"status":"resolved","alerts":[]}' \
  https://fishing-assistant.online/alerts/grafana
```

Expected: missing alert secret returns `401`, and the configured secret returns
accepted JSON with zero created alerts for the no-op payload.

In Grafana Explore:

```logql
{app="fishing-assistant", env="prod", source="docker"}
{app="fishing-assistant", env="prod", source="nginx"}
{app="fishing-assistant", env="prod", service="alert-router", source="journald"}
{app="fishing-assistant", env="prod", source="journald"} |= "deploy"
```

Expected: Docker service logs, nginx logs, alert-router logs, and deploy
journald logs appear for PROD.

## Alert-Router Smoke Payload

The public webhook path is:

```text
DEV:  https://dev.fishing-assistant.online/alerts/grafana
PROD: https://fishing-assistant.online/alerts/grafana
```

Requests without `X-FA-Alert-Secret` must return `401`.

Sample local payload:

```bash
curl -i http://127.0.0.1:9002/alerts/grafana \
  -H "content-type: application/json" \
  -H "X-FA-Alert-Secret: ${FA_ALERT_ROUTER_WEBHOOK_SECRET}" \
  --data '{
    "status": "firing",
    "alerts": [
      {
        "status": "firing",
        "fingerprint": "manual-smoke",
        "labels": {
          "alertname": "Manual Smoke",
          "service": "alert-router",
          "env": "dev",
          "severity": "info"
        },
        "annotations": {
          "summary": "manual alert-router smoke",
          "loki_query": "{app=\"fishing-assistant\", service=\"alert-router\"}",
          "runbook_url": "https://github.com/pbuchman/fishing-assistant/blob/main/docs/operations/fa-observability-runbook.md"
        }
      }
    ]
  }'
```

Expected: `202` and a GitHub investigation issue or deduped response.

## Handling Generated Issues

For a generated issue:

1. Open the linked Grafana rule or panel.
2. Run the Loki query from the issue body.
3. Check the deployment SHA and `service`/`env` labels.
4. Decide whether it is an incident, a known transient, or a noisy rule.
5. Close the issue only after the alert resolves or the rule is corrected.

Resolved Grafana alerts comment on the existing issue when the fingerprint is
known to the router.

## Rollback

Disable the router if it is noisy or misconfigured:

```bash
sudo systemctl disable --now fa-alert-router
```

Disable Alloy collection separately:

```bash
sudo systemctl disable --now fa-alloy
```

Re-enable after correcting config:

```bash
sudo systemctl enable --now fa-alloy
sudo systemctl enable --now fa-alert-router
```

## Secret Rotation

Rotate Loki credentials:

1. Create a new Grafana Cloud Loki token.
2. Update DEV `/etc/fa/observability.env`.
3. Update PROD Secret Manager values.
4. Restart `fa-alloy`.
5. Verify DEV and PROD LogQL queries receive fresh logs.
6. Revoke the old Loki token.

Rotate alert-router webhook secret:

1. Generate a new `FA_ALERT_ROUTER_WEBHOOK_SECRET`.
2. Update DEV `/etc/fa/observability.env`.
3. Update PROD Secret Manager.
4. Update the Grafana webhook contact point header.
5. Restart `fa-alert-router`.
6. Smoke test old secret fails and new secret succeeds.

Rotate GitHub token:

1. Create a new token with issue creation/comment permissions for
   `pbuchman/fishing-assistant`.
2. Update DEV `/etc/fa/observability.env`.
3. Update PROD Secret Manager.
4. Restart `fa-alert-router`.
5. Send the sample payload and verify issue creation.

---
name: grafana-logs
description: Use when investigating Fishing Assistant DEV or PROD runtime behavior through central Grafana Cloud Loki logs, including incident debugging, service error searches, missing log evidence checks, and conversation-specific failures after Firestore or usage evidence has been gathered.
---

# Grafana Logs

## Core Rule

Use only central Grafana Cloud Loki logs. If Loki read access fails or returns no
evidence, report that exact result. Do not use host-local log access as a
fallback.

## Credentials

Use the read-only triplet:

```text
FA_GRAFANA_LOKI_READ_URL
FA_GRAFANA_LOKI_READ_USERNAME
FA_GRAFANA_LOKI_READ_TOKEN
```

These values are separate from the Alloy write triplet. If the read triplet is
not present in the environment, the helper may read the three values from GCP
Secret Manager only with `FA_GCP_PROJECT_ID` and
`FA_GCP_ADMIN_KEY_FILE`.

## Configuration Diagnosis

Before saying live Grafana/Loki access is configured, prove one of these is
true without printing values:

1. A trusted local shell has all three `FA_GRAFANA_LOKI_READ_*` variables.
2. GCP Secret Manager in the project configured by `FA_GCP_PROJECT_ID` has all three
   secrets, each with a latest version, and the shell has `FA_GCP_ADMIN_KEY_FILE`.

Presence-only local check:

```bash
direnv exec . node -e "for (const name of ['FA_GRAFANA_LOKI_READ_URL','FA_GRAFANA_LOKI_READ_USERNAME','FA_GRAFANA_LOKI_READ_TOKEN']) console.log(name + '=' + (process.env[name] ? 'present' : 'missing'))"
```

Presence-only Secret Manager check:

```bash
CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="$FA_GCP_ADMIN_KEY_FILE" \
  gcloud --project "$FA_GCP_PROJECT_ID" secrets list \
  --filter='name~FA_GRAFANA_LOKI_READ' \
  --format='value(name)'
```

If any item is missing, report the exact missing name and where it belongs:

- Grafana Cloud stack: create a Loki read token/access policy with `logs:read`
  and LBAC `{app="fishing-assistant", env=~"dev|prod"}` where
  supported.
- GCP Secret Manager project from `FA_GCP_PROJECT_ID`: store latest
  versions for `FA_GRAFANA_LOKI_READ_URL`,
  `FA_GRAFANA_LOKI_READ_USERNAME`, and `FA_GRAFANA_LOKI_READ_TOKEN`.
- Trusted local shell: either load all three env vars directly, or set
  `FA_GCP_ADMIN_KEY_FILE` so the helper can use the pinned Secret Manager
  fallback.

Never put the read triplet in deployed `/etc/fa/observability.env`, Alloy,
alert-router, app runtime, or provisioner/runtime service-account surfaces.

## Generic Workflow

1. Choose exactly one environment: `dev` or `prod`.
2. Keep the time range small. The helper defaults to `15m` and rejects ranges
   over `2h`.
3. Prefer service and source selectors when known.
4. Run the helper:

```bash
node .codex/skills/grafana-logs/scripts/query-loki.mjs \
  --env prod \
  --service chat-service \
  --since 30m \
  --filter 'error|exception|provider|generation' \
  --limit 50
```

The helper enforces `app="fishing-assistant"` and the exact requested
environment on every generated or raw LogQL query.

## Conversation Workflow

Use this after `.codex/skills/debug-chat-conversation/SKILL.md` has gathered
conversation, message, retrieval, and usage evidence and runtime logs are still
needed.

```bash
node .codex/skills/grafana-logs/scripts/conversation-logs.mjs \
  '<conversation-id>' \
  --env prod \
  --around 2026-06-21T07:23:08Z \
  --window 15m \
  --message-id '<assistant-message-id>' \
  --model '<model-id>'
```

The wrapper queries `chat-service`, `knowledge-service`, and
`llm-usage-service` with safe identifiers only. It searches the Docker
aggregate stream (`service=services`) as well as service-specific labels because
PROD service logs may carry the app service name inside the JSON payload rather
than as the Loki `service` label. The primary query uses the conversation ID
only; when a message ID or model is supplied, the helper also emits a focused
query so sparse error logs are not hidden by overly strict filters. Do not
include raw user prompt text in filters.

## Safety

- Never print Grafana tokens, authorization headers, provider keys, Auth0
  tokens, internal auth tokens, service account JSON, raw chat content,
  provider request bodies, retrieval snippets, or private Knowledge Base text.
- Treat `401 invalid scope requested` as evidence that the read token is
  missing, wrong, or lacks `logs:read`.
- Keep output to timestamps, labels, redacted log lines, operational fields,
  and clear missing-evidence statements.

## Output Contract

Return:

- `Query`: environment, service/source selector, time range, and redacted LogQL.
- `Results`: stream count, entry count, and bounded redacted entries.
- `Conclusion`: what the log evidence supports.
- `Missing evidence`: no results, auth/config failure, or unavailable Loki read
  access.

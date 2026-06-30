# FA Runtime Operations Runbook

This runbook covers deploy/runtime operations for Fishing Assistant.
Use `README.md` for local development and architecture orientation. Use
`docs/operations/fa-observability-runbook.md` for Grafana, Loki, Alloy, and
alert-router operations.

## Environments

- DEV: `dev-host`, PM2, Caddy host `dev.fishing-assistant.online`, deploy
  clone `$HOME/deploy/fishing-assistant`.
- PROD: Hetzner `cx33` in `nbg1`, static primary IPv4, host nginx, one Docker
  container named `fa-services`.
- GCP: retained data plane only, project from `FA_GCP_PROJECT_ID`,
  Firestore, Secret Manager, Terraform state, Firestore backup bucket, public
  share artifact bucket, and service accounts/IAM.

## Secrets

Do not commit:

- `$HOME/.config/gcloud/fa-admin-key.json`
- `.env.dev.local`
- `.env.prod.local`
- `.envrc`
- `/etc/fa/keys/provisioner-sa-key.json`
- `/etc/fa/keys/runtime-sa-key.json`

Runtime Secret Manager entries:

- `FA_INTERNAL_AUTH_TOKEN`
- `FA_INTERNAL_AUTH_TOKEN_PREVIOUS`
- `FA_DEV_OPENROUTER_APP_API_KEY`
- `FA_DEV_MINIMAX_APP_API_KEY`
- `FA_OPENROUTER_APP_API_KEY` (retired shared secret retained for rollback)
- `FA_PROD_OPENROUTER_APP_API_KEY`
- `FA_PROD_MINIMAX_APP_API_KEY`
- `FA_OPENAI_APP_API_KEY`
- `FA_GEMINI_APP_API_KEY`

Local and DEV env rendering reads `FA_DEV_OPENROUTER_APP_API_KEY` and
`FA_DEV_MINIMAX_APP_API_KEY`, then writes runtime
`FA_OPENROUTER_APP_API_KEY` and `FA_MINIMAX_APP_API_KEY`. PROD env rendering
reads `FA_PROD_OPENROUTER_APP_API_KEY` and
`FA_PROD_MINIMAX_APP_API_KEY`, then writes the same runtime env names. Keep
the retired shared OpenRouter secret until all deployed and local paths have
been rotated and smoke-tested.

Provisioning-only Secret Manager entry:

- `FA_CLOUDFLARE_DNS_API_TOKEN`

`FA_CLOUDFLARE_DNS_API_TOKEN` is not runtime config. Certificate provisioning
fetches it directly with the provisioner key and writes only the root-owned
certbot credentials file.

## Public Homepage

DEV and PROD homepage entry routes `/` and `/index.html` are public and must
return `200` without an extra edge password. `/app` remains protected by Auth0
inside the product UI, and `/api/*/internal/*` remains blocked at the edge.

## Production Credential Matrix

This runbook is the operator-facing checklist for production key installation,
read-only runtime mounting, rotation, and old-key revocation.

| Identity                 | Purpose                                                                                            | Key location                                                                                         | Permissions and ownership                                                | Allowed roles                                                                                                                                | Forbidden roles and uses                                                                                                                                        | Rotation                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `fa-admin`               | Bootstrap Terraform and retained GCP data-plane administration from trusted operator environments. | Local operator key only; never GitHub Actions or production runtime.                                 | Out-of-band install; local-only restrictive file permissions.            | Bootstrap IAM and service-account administration needed to maintain the retained GCP data plane.                                             | No app runtime use, no Hetzner copy, no GitHub Actions deploy key, no production `GOOGLE_APPLICATION_CREDENTIALS`.                                              | Rotate before launch, at least quarterly, and after suspected exposure; revoke old keys after replacement smoke tests. |
| `fa-hetzner-provisioner` | Read explicit runtime and provisioning Secret Manager allowlists during deploy/provisioning.       | `/etc/fa/keys/provisioner-sa-key.json`.                                                              | `root:deploy` or stricter, mode `0400` or `0440`; installed out-of-band. | `roles/secretmanager.secretAccessor` only on explicit runtime/provisioning secrets; approved backup-bucket grant where Terraform defines it. | No Firestore runtime roles, owner/editor, service-account admin, service-account key admin, broad project admin roles, or PM2 runtime use.                      | Rotate at least quarterly and after suspected exposure; revoke old keys after replacement deploy and smoke tests.      |
| `fa-hetzner-runtime`     | Firestore access for production PM2 services inside the Docker container.                          | Host `/etc/fa/keys/runtime-sa-key.json`, mounted read-only to `/run/secrets/fa-runtime-sa-key.json`. | `root:deploy` or stricter, mode `0440`; Docker mount must be read-only.  | Firestore access only, currently `roles/datastore.user` until a narrower custom role exists.                                                 | No Secret Manager accessor, owner/editor, service-account admin, service-account key admin, broad project admin roles, provisioning use, or GitHub Actions use. | Rotate at least quarterly and after suspected exposure; revoke old keys after container smoke tests pass.              |

Operator checklist:

- Install provisioner and runtime keys out-of-band.
- Do not put private key JSON in Terraform variables, Terraform state, GitHub
  secrets, or repo files.
- Verify `/etc/fa/keys/provisioner-sa-key.json` is `root:deploy` or stricter
  with mode `0400` or `0440`.
- Verify `/etc/fa/keys/runtime-sa-key.json` is `root:deploy` or stricter with
  mode `0440`.
- Verify the services container mounts the runtime key read-only at
  `/run/secrets/fa-runtime-sa-key.json`.
- Rotate keys before first production launch, at least quarterly, and after any
  suspected exposure.
- Revoke old key versions after replacement deploy and smoke tests pass.

## Bootstrap GCP Data Plane

```bash
scripts/bootstrap/bootstrap-gcp-data-plane.sh
scripts/bootstrap/bootstrap-gcp-data-plane.sh --apply
scripts/bootstrap/bootstrap-gcp-data-plane.sh --migrate
```

The script pins the dedicated service account and project before running
`gcloud`, Terraform, or migrations.

## Bootstrap Hetzner PROD

```bash
cd terraform/hetzner-prod
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

After apply, copy or generate these keys out-of-band:

```text
/etc/fa/keys/provisioner-sa-key.json
/etc/fa/keys/runtime-sa-key.json
```

Then provision the host:

```bash
ssh root@<hetzner-ip>
cd /opt/fishing-assistant/current
FA_ENVIRONMENT=prod bash scripts/hetzner/provision.sh
sudo -n /usr/local/sbin/fa-deploy-nginx /opt/fishing-assistant/current --origin-http-only
```

Use `--origin-http-only` only before Cloudflare DNS and a real Let's Encrypt
certificate are ready. After the real provisioning-only
`FA_CLOUDFLARE_DNS_API_TOKEN` Secret Manager value and DNS record exist,
replace the origin-only config with the HTTPS config:

```bash
sudo FA_ENVIRONMENT=prod bash scripts/hetzner/install-nginx-and-cert.sh --email ops@example.com
sudo -n /usr/local/sbin/fa-deploy-nginx /opt/fishing-assistant/current
```

## DEV Deploy

Automatic DEV deploys are handled by the `dev-host` webhook after pushes to
`main`.

Manual DEV deploy from an FA worktree:

```bash
branch="$(git branch --show-current)"
sha="$(git rev-parse HEAD)"
scripts/deploy/deploy-dev.sh --branch "$branch" --sha "$sha"
```

DEV edge routing uses a host-level FA Caddy site that lives outside this
product repository. Copy or merge
`scripts/dev-host/caddy/fishing-assistant.Caddyfile` into that
host-level FA Caddy site. Copy or merge
`scripts/dev-host/caddy/fishing-assistant-observability.Caddyfile`
before the frontend fallback so `/healthz` returns `ok` at the edge and
`/alerts/grafana` proxies to the local alert-router on `127.0.0.1:9002`.

## PROD Deploy

Preferred path:

```bash
gh workflow run deploy.yml -f environment=prod -f ref=main -f deploy_nginx=false
```

The production services image build prunes unused Docker containers, unused
Docker images, and builder cache before `docker build` while the current
`fa-services` container is still running. Docker preserves the running image,
so the deploy path frees failed-build and older release debris without removing
the active rollback image.

Normal production deploys require unauthenticated HTTP `200` from HTTPS
static-IP `/`, `/index.html`, `/healthz`, `/app`, and public `/api/*/health`.
`deploy_nginx=false`. The `deploy_nginx` input only publishes and reloads nginx
config.

Use the bootstrap escape hatch only for first-origin HTTP bootstrap before
Cloudflare DNS/TLS and the production certificate are ready:

```bash
gh workflow run deploy.yml -f environment=prod -f ref=main -f deploy_nginx=true -f bootstrap_origin_http_only=true
```

Fallback path from a GitHub Actions runner or equivalent shell:

```bash
DEPLOY_SHA="$(git rev-parse HEAD)"
pnpm run ci:prod
FA_HETZNER_PROD_HOST=<ip> \
FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY="$(cat ~/.ssh/fa_hetzner_deploy)" \
scripts/hetzner/github-actions-deploy.sh --sha "$DEPLOY_SHA"
```

Fallback bootstrap mode uses:

```bash
scripts/hetzner/github-actions-deploy.sh --sha "$DEPLOY_SHA" --deploy-nginx --bootstrap-origin-http-only
```

Bootstrap mode skips only public HTTPS edge checks. It still requires HTTP
`200` from loopback service health and local nginx/origin `/healthz`, `/app`,
`/`, `/index.html`, and `/api/*/health`.

## Cloudflare

Initial DNS records:

```text
A fishing-assistant.online <hetzner-primary-ip>
CNAME dev.fishing-assistant.online <existing-dev-host-tunnel-hostname>
```

Before Cloudflare DNS/TLS is ready, use `bootstrap_origin_http_only=true` for
deploys and verify the HTTP origin directly:

```bash
curl --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/healthz
curl --fail --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/
curl --fail --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/index.html
curl -o /dev/null -w '%{http_code}' --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/api/chat/health
```

Keep the production A record DNS-only until direct-origin HTTPS checks pass:

```bash
curl --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/healthz
curl --fail --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/
curl --fail --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/index.html
curl -o /dev/null -w '%{http_code}' --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/api/chat/health
```

Enable Cloudflare proxy only after direct-origin HTTPS checks and API health
checks pass.

## Smoke

DEV:

```bash
curl --fail https://dev.fishing-assistant.online/healthz
curl --fail https://dev.fishing-assistant.online/
curl --fail https://dev.fishing-assistant.online/index.html
curl --fail https://dev.fishing-assistant.online/app
curl --fail https://dev.fishing-assistant.online/api/chat/health
FA_DEV_ORIGIN=https://dev.fishing-assistant.online node scripts/smoke/e2e-dev.mjs
```

PROD direct origin:

```bash
curl --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/healthz
curl --fail --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/
curl --fail --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/index.html
curl --fail --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/app
curl -o /dev/null -w '%{http_code}' --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/api/chat/health
curl -o /dev/null -w '%{http_code}' --resolve fishing-assistant.online:80:<hetzner-primary-ip> http://fishing-assistant.online/api/chat/internal/not-public
```

PROD direct origin after Cloudflare DNS/TLS:

```bash
curl --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/healthz
curl --fail --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/
curl --fail --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/index.html
curl --fail --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/app
curl -o /dev/null -w '%{http_code}' --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/api/chat/health
curl -o /dev/null -w '%{http_code}' --resolve fishing-assistant.online:443:<hetzner-primary-ip> https://fishing-assistant.online/api/chat/internal/not-public
```

Homepage routes `/` and `/index.html` must return `200` without extra headers.
The public internal route must return `403` or `404`.

## Chat Provider Rollout Checks

The default chat provider is OpenRouter. Before validating a deployment that
changes the chat model catalog or the default setting, run pending migrations
from the deployed clone so `fa_chat_runtime_settings/chat-model` is reset away
from retired model IDs:

```bash
direnv exec . pnpm run migrate
direnv exec . pnpm run migrate:status
```

For DEV first, then PROD only after DEV passes:

- Confirm the runtime env contains `FA_OPENROUTER_APP_API_KEY`; do not print
  or commit the value.
- Confirm the runtime env contains `FA_MINIMAX_APP_API_KEY`; do not print or
  commit the value.
- Confirm any local/admin OpenRouter key needed for dashboard administration is
  sourced from the trusted shell, such as the operator zsh profile, without
  echoing the secret.
- Validate the OpenRouter catalog models in the OpenRouter dashboard before
  rollout.
- Validate `MiniMax-M3` with the direct MiniMax key before switching the admin
  provider flag to MiniMax.
- Confirm `FA_OPENROUTER_PROVIDER_SORT=throughput` is present when the runtime
  should prefer throughput-first OpenRouter provider routing.
- Confirm OpenRouter credits and spend limits are acceptable for the expected
  chat volume.
- Confirm the app name/site headers remain configured if the account currently
  uses them.
- Use the admin runtime diagnostics route to confirm the active model resolves
  to `deepseek/deepseek-v4-flash` on `openrouter`; diagnostics must not expose
  secrets.
- Keep rollback ready through the admin settings route to
  `openrouter:minimax/minimax-m3` or `minimax:MiniMax-M3`.
- Ask one normal fishing question, one question where the Knowledge Base lacks
  information, and one citation-heavy question.
- Confirm streaming completes, citations render, usage tracking records
  `deepseek/deepseek-v4-flash`, and logs show no JSON parse or repair-loop
  failures.
- Confirm the OpenRouter usage dashboard shows expected model traffic and no
  unexpected spend spike.

## Firestore Backups

Start an export:

```bash
scripts/ops/export-firestore-backup.sh
```

Target:

```text
gs://<firestore-backup-bucket>/exports/<timestamp>
```

Run restore drills in a non-production database or project and document the
exact restore command used.

## Rollback

Rollback requires the previous release SHA. On the Hetzner host:

```bash
previous_sha=<previous-sha>
sudo ln -sfn "/opt/fishing-assistant/releases/${previous_sha}" /opt/fishing-assistant/current
sudo ln -sfn "/var/www/fa/releases/${previous_sha}" /var/www/fa/current
cd /opt/fishing-assistant/current
FA_ENVIRONMENT=prod bash scripts/hetzner/reload-services-container.sh --sha "${previous_sha}"
sudo -n /usr/local/sbin/fa-deploy-nginx /opt/fishing-assistant/current
curl --fail http://127.0.0.1/healthz
curl --fail http://127.0.0.1:3201/health
curl --fail http://127.0.0.1:3202/health
curl --fail http://127.0.0.1:3203/health
```

Keep at least the current and previous release directories and Docker images
until the replacement has been smoke-tested.

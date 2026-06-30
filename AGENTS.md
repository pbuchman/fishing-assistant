# AGENTS.md

## Purpose

This file is the project rule source for Fishing Assistant.

There is no alternate assistant instruction file in this repository. Do not
create one. Codex-facing project behavior belongs here and in checked-in
`.codex/skills/*/SKILL.md` files.

## Session Start Gate

Before analysis, edits, tests, deploys, branch actions, or commits, read:

1. `AGENTS.md`
2. `.codex/skills/deploy/SKILL.md`
3. Relevant living docs for the task:
   - `README.md` for product, local runtime, build, and quality gates
   - `docs/operations/fa-mvp-runbook.md` for deployment/runtime operations
   - `docs/operations/fa-observability-runbook.md` for Grafana/Loki/Alloy and
     alert-router operations

If a referenced file is missing, report it and continue with the available
files.

## Branch And Pull Request Workflow

Before starting any task work, fetch current `origin/main`:

```text
git fetch origin main
```

Unless the user explicitly says otherwise, agents must:

1. Work on a branch based on current `origin/main`, not directly on `main`.
2. Commit the completed task work on that branch.
3. Push the branch.
4. Finalize the task by opening a pull request targeting `main`.

Commit messages and pull request titles must be plain project messages. Do not
include the literal `[codex]` marker anywhere in a commit message or pull
request title. For example, use `docs: clarify agent commit naming rules`
instead of `[codex] docs: clarify agent commit naming rules`.

Pull requests opened by Codex must be marked ready for review. Do not open
Codex pull requests as drafts.

This workflow rule intentionally takes precedence over any conflicting
Superpowers skill instruction, including
`superpowers:finishing-a-development-branch`. Do not use that skill's local
merge/keep/discard option menu as the default for this repository. The default
finalization path is always a pull request to `main`.

Explicit user instructions still override this rule. Examples include "work on
main", "do not create a pull request", "do not push", or "only prepare a
patch".

## Product

Fishing Assistant is a standalone React and Fastify application.
Admin users maintain a Markdown Knowledge Base. The Knowledge Service chunks
and embeds pages for vector-backed retrieval. Approved users ask questions in a
ChatGPT-like interface. The LLM composes answers from retrieved evidence,
includes citations when source URLs are available, and clearly states when the
accessible Knowledge Base is missing information.

## Repository Rules

- Main branch: `main`.
- GitHub repository:
  `https://github.com/pbuchman/fishing-assistant`.
- Do not create alternate assistant instruction files.
- Keep project automation in `AGENTS.md`, `.codex/skills/`, `scripts/`, and
  docs.
- Codex sessions for this repository must use user-wide `superpowers@personal`
  at Superpowers major version 6. Do not install or rely on
  `superpowers@openai-curated` for this repository.
- Use `FA_` for all product-owned environment variables.
- Do not introduce non-FA product environment variables.
- Auth/runtime env must stay on the checked-in FA surfaces: Auth0 browser
  config, Auth0 verifier env, same-origin `/api/users`, and internal-auth
  service URLs/tokens.
- API routing must follow the checked-in service-manifest pattern: frontend
  uses same-origin `/api/*`; Vite, DEV Caddy, PROD nginx, and Terraform wiring
  are generated or verified from one manifest.
- Keep local secrets, service account keys, `.env.*.local`, and `.envrc`
  untracked.
- Use the configured GCP project from `FA_GCP_PROJECT_ID`.
- Use the dedicated admin service account
  from `FA_GCP_ADMIN_SERVICE_ACCOUNT`.
- Do not add assistant pre/post tool-use hooks or required git lifecycle hooks.
  Quality gates must be explicit package scripts and CI jobs.

## Environments

| Environment | Target                                  | Manager                                           | Deployment                                                         |
| ----------- | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `local`     | current checkout                        | PM2 + Vite dev server                             | none; manual `pnpm run dev`                                        |
| `dev`       | `dev-host` deploy clone                 | PM2 + built web preview behind DEV edge routing   | GitHub webhook after merge/push to `main`, plus Codex deploy skill |
| `prod`      | Hetzner static primary IPv4 + `cx33` VM | nginx + one Docker container running PM2 services | Codex deploy skill / GitHub Actions                                |

`local` is not a deployed environment. It is the current working checkout used
by humans and agents to run the full app locally against the real FA GCP data
plane without deploying to DEV. Treat any current checkout context as `local`,
not as `dev`.

`dev` is not GCP. It runs from the deploy clone on `dev-host` through the DEV
runtime defined in this repository.

`prod` uses a Hetzner static primary IPv4, a `cx33` VM, host nginx, and one
Docker container running PM2-managed backend services. GCP is retained for
Firestore, Secret Manager, Firestore backups, and public share artifacts.

## Local Runtime

Local runtime uses:

- `.env.dev.local`
- `.envrc`
- `ecosystem.local.config.cjs`
- PM2 with watched backend services
- Vite dev server for the web app
- real FA GCP data through the local admin service-account key

Run locally with:

```text
pnpm run dev
```

Trusted local shells may create ignored local env files from approved external
sources first:

```text
pnpm run local:env:pull
direnv allow
```

`pnpm run dev` validates ignored local env files, regenerates service wiring,
starts PM2 from `ecosystem.local.config.cjs`, and tails FA service logs.
Backend service source changes reload through PM2 watch mode. Web page changes
refresh through Vite dev/HMR. Local runtime must not require deploying to DEV
and must not use Firestore, Storage, or Pub/Sub emulators.

Before trusting local UI behavior, verify that local services can reach GCP,
especially Firestore. `node scripts/dev-setup.mjs` must pass, emulator env vars
must be absent, and local service health checks that include Firestore must
report `status: ok`.

If local authorization fails, do not disable auth or bypass Auth0. Report the
exact failing authorize URL, `redirect_uri`, origin, Auth0 domain/client ID
presence, and browser console/API errors. The Auth0 application used by
`.env.dev.local` must allow the local callback and origin used by Vite,
notably `http://127.0.0.1:3100` for web origins/CORS and the exact local
callback redirect URI requested by the app.

Local and DEV browser test credentials live outside this repository at:

```text
$HOME/.config/fishing-assistant/logins.md
```

Keep this file untracked and `chmod 600`. Each test account entry must record
the email, environment, user role, user access tier, current account state, and
intended automated-testing use. Do not commit test passwords.

## DEV Deployment

DEV lives in the deploy clone on `dev-host`:

```text
$HOME/deploy/fishing-assistant
```

DEV uses `.env.dev.local`, `.envrc`, PM2, the tracked PM2 app config, the built
web bundle served through Vite preview, and the GitHub webhook handler.

The GitHub webhook handler must:

- verify `X-Hub-Signature-256`
- accept `push` events
- deploy only `main` for automatic DEV updates
- fetch and reset the deploy clone to `origin/main`
- run `pnpm install --frozen-lockfile`
- regenerate service wiring
- verify service wiring and env
- run the required build
- reload all FA PM2 services after each accepted `main` push
- return a clear JSON status

The current DEV reliability baseline is a full FA PM2 reload after accepted
`main` pushes. The finer affected-service restart matrix is an optimization,
not a current correctness requirement.

FA webhook:

```text
origin: https://dev.fishing-assistant.online
service: fa-webhook-handler
port: 9001
health path: local http://localhost:9001/health
webhook path: /webhook on the dedicated FA DEV origin
repo: $HOME/deploy/fishing-assistant
implementation: scripts/dev-host/webhook-handler.mjs
deploy script: scripts/deploy/deploy-dev.sh
```

## PROD Deployment

PROD app compute runs on Hetzner host nginx plus one Docker container running
PM2-managed backend services, not on GCP. GCP remains the retained data plane
for Firestore, Secret Manager, Firestore backups, and public share artifacts in
the project configured by `FA_GCP_PROJECT_ID`.

Production runtime layout:

```text
/opt/fishing-assistant/releases/<sha>
/opt/fishing-assistant/current
/etc/fa/.env.prod
/etc/fa/observability.env
/etc/fa/keys/runtime-sa-key.json
/etc/fa/keys/provisioner-sa-key.json
/run/secrets/fa-runtime-sa-key.json (read-only container mount)
/var/www/fa/releases/<sha>
/var/www/fa/current
Docker container: fa-services
```

nginx serves the built React app and proxies same-origin `/api/*` paths to
backend ports published by Docker on host loopback only. Public nginx must not
expose `/api/*/internal/*`. Public share artifacts are stored in the
Terraform-owned shared-content GCS bucket and served through nginx at
`https://fishing-assistant.online/share/<slug>`.

Public origins:

```text
DEV:  https://dev.fishing-assistant.online
PROD: https://fishing-assistant.online
```

Operational deployment details live in
`docs/operations/fa-mvp-runbook.md`. Observability details live in
`docs/operations/fa-observability-runbook.md`. Link to those files only for
deployment/runtime or observability work.

## Deploy Skill

The repository must include a Codex deploy skill:

```text
.codex/skills/deploy/SKILL.md
```

Use it whenever the user asks to deploy.

Environment resolution:

- If the user says `prod`, `production`, or `hetzner`, deploy `prod`.
- If the user says `dev`, `dev-host`, or nothing, deploy `dev`.
- Default is `dev`.

The deploy skill deploys committed state from the current branch. If the
worktree has uncommitted changes, stop and explain that only committed code is
deployable.

DEV deploys run generated-config/env verification and build before PM2
restarts. PROD deploys run `pnpm run ci:prod` or an equivalent GitHub Actions
gate before SSH deploy to Hetzner.

## Environment Files

Committed templates:

```text
.env.example
.env.dev.example
.env.prod.example
.envrc.example
```

Ignored local files:

```text
.env
.env.*
.envrc
.envrc.local
```

with exceptions for committed examples:

```text
!.env.example
!.env.*.example
```

Default local setup:

```text
cp .env.dev.example .env.dev.local
cp .envrc.example .envrc
direnv allow
```

Profile switch:

```text
export FA_ENV_FILE=.env.prod.local
direnv reload
```

## GCP Data Plane Bootstrap

Project:

```text
FA_GCP_PROJECT_ID=replace-with-gcp-project-id
FA_GCP_PROJECT_NUMBER=replace-with-gcp-project-number
FA_GCP_ORGANIZATION_ID=replace-with-gcp-organization-id
FA_GCP_BILLING_ACCOUNT_ID=replace-with-gcp-billing-account-id
FA_GCP_REGION=europe-central2
FA_DATA_PLANE=gcp
```

Admin service account:

```text
FA_GCP_ADMIN_SERVICE_ACCOUNT=replace-with-admin-service-account
FA_GCP_ADMIN_KEY_FILE=replace-with-local-fa-admin-key-path
```

When running GCP commands from a shell that may inherit unrelated env vars, pin
the account and project explicitly:

```text
gcloud --account="$FA_GCP_ADMIN_SERVICE_ACCOUNT" --project="$FA_GCP_PROJECT_ID" ...
```

Terraform commands for retained GCP resources should set:

```text
GOOGLE_APPLICATION_CREDENTIALS=$FA_GCP_ADMIN_KEY_FILE
GOOGLE_CLOUD_PROJECT=$FA_GCP_PROJECT_ID
```

Terraform for production compute belongs in `terraform/hetzner-prod/` and must
use the Hetzner provider plus the checked-in FA runtime/bootstrap pattern. The
retained GCP root should own only Firestore, Secret Manager, Firestore backup
and public share artifact buckets, and the service accounts/IAM needed for
those resources.

## Architecture Rules

- Backend services use Fastify and the FA service shape: `domain`, `infra`,
  `routes`, `config.ts`, `server.ts`, `services.ts`, `index.ts`.
- Apps must not import other apps.
- Service-to-service calls use internal HTTP and `X-Internal-Auth`.
- Public app auth uses Auth0 bearer tokens plus `user-service` authorization
  resolution. There is no retired auth fallback.
- New self-signups are restricted to Auth0 identities whose normalized email
  matches `FA_SIGNUP_ALLOWED_EMAIL_PATTERN`. Auth0 should reject other addresses
  before app callback, and `user-service` must also reject non-matching
  brand-new regular users before creating a local FA account. Bootstrap admin
  grants and existing-user email changes still require a verified Auth0 email.
- Firestore collections must have one owner in `firestore-collections.json`.
- Deletes are soft deletes.
- Knowledge Base sync is required.
- LLM usage/cost tracking is required for chat and embeddings.
- Chat and usage records are owned by real `userId` values. Admin knowledge
  routes operate on shared knowledge pages and access metadata.
- Web uses hash routing.
- Vite must be configured with `envPrefix: 'FA_'`.
- Browser API clients must call same-origin `/api/chat`, `/api/knowledge`,
  `/api/llm-usage`, and `/api/users`, not service-local ports.
- Browser code must never receive provider API keys or `FA_INTERNAL_AUTH_TOKEN`.
- DEV deploys must keep the frontend and all services current after pushes to
  `main`; PM2 file watching is not the source of truth.
- Deploy and monitoring gates must include generated-config verification, env
  verification, auth/runtime static verification, and the required build before
  PM2 reloads or PROD release steps.
- Build quality is enforced by `pnpm run ci` and `pnpm run ci:prod`, not by
  hidden hooks.
- Observability uses Grafana/Loki/Alloy only. Do not add Sentry runtime SDKs or
  Sentry-owned env vars unless a future spec explicitly reverses this decision.

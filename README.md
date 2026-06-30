# Fishing Assistant

Fishing Assistant is an authenticated web application for working
with a managed fishing knowledge base. Admin users maintain Markdown knowledge
pages, the knowledge service chunks and embeds those pages into a vector-backed
Firestore data plane, and approved users ask questions through a ChatGPT-like
chat interface. Answers are composed from retrieved evidence, include citations
when source URLs are available, and must clearly say when the accessible
knowledge base does not contain enough information.

The product is a standalone React and Fastify monorepo. It uses Auth0 for
browser sign-in, a user service for local authorization and approval state,
separate backend services for chat, knowledge, and LLM usage tracking, and GCP
for Firestore, Secret Manager, backups, and public share artifacts. Browser
clients call same-origin `/api/*` routes generated from one service manifest.

## Repository Shape

- `apps/web`: Vite React frontend with hash routing, Auth0, chat, profile, and
  admin Knowledge Base screens.
- `apps/chat-service`: conversation CRUD, SSE streaming, RAG orchestration, and
  answer persistence.
- `apps/knowledge-service`: admin Knowledge Base pages, sync/reindex,
  embeddings, vector retrieval, and access filtering.
- `apps/llm-usage-service`: token and cost tracking for chat and embedding
  usage.
- `apps/user-service`: Auth0 JWT verification, user bootstrap, approval,
  suspension, access tiers, and admin user management.
- `packages/*`: shared contracts, HTTP helpers, Firestore, observability,
  internal clients, LLM adapters, and pricing helpers.
- `scripts/*`: env validation, service wiring generation, build, deploy,
  smoke, migration, observability, and verification tooling.
- `docs/operations/*`: operator runbooks for deploy/runtime and observability.

The main branch is `main`. Agents and humans should work on feature branches
and open pull requests to `main` unless a task explicitly says otherwise.

## Local Requirements

- Node `>=22.12.0`
- pnpm `>=10.29.3`
- direnv
- PM2, installed through the workspace dev dependency
- Access to the GCP project configured by `FA_GCP_PROJECT_ID`
- Local admin service-account key at the path used by `FA_GCP_ADMIN_KEY_FILE`

Local runtime uses real FA GCP resources. Do not set Firestore, Storage, or
Pub/Sub emulator variables for this project.

## Local Environment

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Create ignored local env files:

```bash
cp .env.dev.example .env.dev.local
cp .envrc.example .envrc
direnv allow
```

Trusted local shells with GitHub CLI access, GCP Secret Manager access, and the
FA admin key can render the ignored local env from approved external sources:

```bash
pnpm run local:env:pull
direnv allow
```

`pnpm run local:env:pull` reads DEV Auth0 browser values from GitHub repository
variables and backend/runtime values from GCP Secret Manager. It must not print
secret values.

Before trusting local runtime, verify env and GCP access:

```bash
node scripts/dev-setup.mjs
```

The checker requires `.env.dev.local`, `.envrc`, `FA_DATA_PLANE=gcp`, a real
`FA_GCP_PROJECT_ID`, a readable local admin key, real Auth0/provider
values, and no emulator environment variables.

## Run Locally

Start the full local app:

```bash
pnpm run dev
```

`pnpm run dev` runs `scripts/dev-setup.mjs`, regenerates service wiring, starts
PM2 from `ecosystem.local.config.cjs`, and tails the local service logs.

Useful local service commands:

```bash
pnpm run services:start
pnpm run services:status
pnpm run services:logs
pnpm run services:restart
pnpm run services:stop
```

Open the web app at the Vite local origin configured by the PM2 web process,
normally `http://127.0.0.1:3100`.

## Rebuild Behavior

Automatically refreshed during `pnpm run dev`:

- Web source and style changes refresh through Vite dev/HMR.
- Backend service source changes reload through PM2 watch mode.
- Service URL wiring is regenerated when `pnpm run dev` starts.

Manual action required:

- Change `apps/web/service-manifest.json`: run
  `pnpm run generate:service-wiring` and `pnpm run verify:service-wiring`, then
  restart local services if PM2 did not reload the affected process.
- Change `.env.dev.local`, `.envrc`, PM2 config, package dependencies, or
  service startup config: run `pnpm run services:restart`.
- Change dependencies or lockfile: run `pnpm install --frozen-lockfile`, then
  restart services.
- Need production-shaped bundles: run `pnpm run build`, `pnpm run build:web`,
  `pnpm run build:services`, or `pnpm run build:prod` as appropriate.
- Need a clean full local quality gate: run `pnpm run ci`.

## GCP And Dependencies

Configured GCP project:

```text
$FA_GCP_PROJECT_ID
```

Local admin service account:

```text
$FA_GCP_ADMIN_SERVICE_ACCOUNT
```

Pin account and project when running GCP commands from a shell that may inherit
unrelated environment:

```bash
gcloud --account="$FA_GCP_ADMIN_SERVICE_ACCOUNT" \
  --project="$FA_GCP_PROJECT_ID" ...
```

Retained GCP resources include Firestore, Secret Manager, Firestore backups,
public share artifacts, and service accounts/IAM for those resources. Runtime
compute is local PM2, DEV PM2 on `dev-host`, or Hetzner nginx plus one Docker
container for PROD.

## Quality Gates

Common checks:

```bash
pnpm run verify
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

Full local CI:

```bash
pnpm run ci
```

Production readiness:

```bash
pnpm run ci:prod
```

`pnpm run ci` runs service wiring, env checks, security/secret scans,
typecheck, lint, static verification, knowledge and observability verification,
ops tests, coverage, build, and format check. `pnpm run ci:prod` adds shell,
Terraform, production build, and production runtime verification.

## Deployments

DEV runs from `$HOME/deploy/fishing-assistant` on `dev-host`. Pushes
to `main` are deployed by the FA webhook, and manual DEV deploys use:

```bash
branch="$(git branch --show-current)"
sha="$(git rev-parse HEAD)"
scripts/deploy/deploy-dev.sh --branch "$branch" --sha "$sha"
```

PROD runs on Hetzner with host nginx serving the web bundle and proxying
same-origin `/api/*` routes to one Docker container running PM2-managed backend
services. Production deploys normally use the GitHub Actions deploy workflow
after the ref is merged to `main`.

Use the Codex deploy skill for deploy requests. It deploys committed branch
state only and stops on dirty worktrees.

Operational details live in:

- [`docs/operations/fa-mvp-runbook.md`](docs/operations/fa-mvp-runbook.md)
- [`docs/operations/fa-observability-runbook.md`](docs/operations/fa-observability-runbook.md)

## Migrations

Migration files in `migrations/` are immutable after they have been applied.
The Firestore `_migrations` ledger stores the checksum applied for each
migration.

Check live migration status:

```bash
pnpm run migrate:status
```

Run intentional offline discovery when credentials are unavailable:

```bash
node scripts/migrate.mjs --status
```

Checksum drift is a failure. Restore the original migration or add an explicit
repair workflow before accepting drift.

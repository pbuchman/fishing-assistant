---
name: deploy
description: Deploy Fishing Assistant to dev on home-dev by default, or to prod on Hetzner when explicitly requested.
---

# Deploy

## Scope

Use this skill only in the Fishing Assistant repository.

Before deploying, confirm:

1. repo root contains `AGENTS.md`
2. repo root contains `.codex/skills/deploy/SKILL.md`
3. current repo is `fishing-assistant`

If any check fails, stop and report that this deploy skill is repo-specific.

## Environment Resolution

Default environment is `dev`.

Resolve the target from the user's request:

- `prod`, `production`, `hetzner` -> `prod`
- `dev`, `dev-host`, no environment -> `dev`

If the wording is ambiguous and includes both environments, ask the user to choose.

## Deployable State

Deploy only committed code from the current branch.

Before deploying:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
```

If there are uncommitted changes, stop. Explain that the deploy skill deploys committed branch state only.

## Deploy Failure Remediation

If a deploy fails or verification exposes a real problem, do not leave the fix
as an uncommitted local change or an out-of-band server tweak.

1. Diagnose the failing deploy step from logs, health checks, and the relevant
   deploy script before changing code.
2. If the fix belongs to the deployed app, infrastructure scripts, tests, or
   repo-owned runtime configuration, implement it in the repository.
3. If the failure reveals a missing deploy instruction, unclear recovery step,
   or repeatable process gap, update this deploy skill in the same fix branch
   or a dedicated follow-up branch.
4. Verify the fix with the smallest relevant command first, then run the
   required deploy gate for the target environment.
5. Commit and push all deploy-related code, script, config, test, and skill
   fixes before retrying the deploy.
6. Open a pull request for the fix branch, merge it to `main` when checks pass,
   then deploy fresh `origin/main` unless the user explicitly requested a
   different pushed ref.

If the failure is caused only by external state that cannot be changed from the
repo, report the blocker with the exact failing check and the required external
action.

## DEV Deploy

DEV runs on `home-dev` under PM2. Use the Tailscale name `home-dev` for SSH
when connecting from another network. Do not rely on a changing LAN address.
The public repository cutover and systemd installation procedure is documented
in `docs/operations/dev-public-repository-cutover.md`.

Default target:

```text
$HOME/deploy/fishing-assistant
```

DEV deploy should:

1. Resolve current branch and `HEAD` SHA.
2. Ensure the deploy clone exists.
3. Fetch the committed branch/SHA into the deploy clone.
4. Reset the deploy clone to that SHA.
5. Load `.env.dev.local` through direnv.
6. Run dependency install if lockfile changed.
7. Regenerate service wiring if routing manifests changed.
8. Verify service wiring and env.
9. Run the build pipeline required by the DEV deploy script and `README.md`.
10. Rebuild the frontend if web, shared package, routing, env, or lockfile changes require it.
11. Rebuild or restart affected backend services.
12. Restart all FA PM2 services for shared package, ecosystem, routing, or lockfile changes.
13. Verify health endpoints.

If running on `dev-host`, the deploy script may fetch directly from the current local repository path. If running elsewhere, the branch must be pushed to origin first.

Planned command:

```bash
scripts/deploy/deploy-dev.sh --branch <current-branch> --sha <head-sha>
```

This script exists and is the required DEV deploy path. It fetches the committed
branch/SHA into `$HOME/deploy/fishing-assistant`, regenerates
service wiring, verifies env/routing, builds, and reloads FA PM2 processes.

## PROD Deploy

PROD runs on a Hetzner static primary IPv4 plus a `cx33` VM. nginx runs on the
host and proxies to one Docker container running PM2-managed backend services.
GCP is used only for Firestore and Secret Manager in:

```text
fishing-assistant
```

Region:

```text
europe-central2
```

PROD deploy should:

1. Require the branch/SHA to be pushed to GitHub.
2. Run or verify `pnpm run ci:prod` or an equivalent GitHub Actions gate.
3. SSH to the Hetzner production VM.
4. Sync the checked-out commit to a release directory under `/opt/fishing-assistant/releases/<sha>`.
5. Refresh `/etc/fa/.env.prod` from GCP Secret Manager.
6. Run `pnpm install --frozen-lockfile`.
7. Build and publish the web bundle.
8. Prune unused Docker containers, images, and builder cache while the current
   services container is still running, then build/reload the single Docker
   services container.
9. Reload nginx when requested.
10. Verify static-IP and service health endpoints.

Production runtime and operator details are maintained in
`docs/operations/fa-mvp-runbook.md`. Observability deployment details are
maintained in `docs/operations/fa-observability-runbook.md`.

Preferred mechanism:

```bash
gh workflow run deploy.yml -f environment=prod -f ref=<branch-or-sha>
```

Normal production deploys must use a ref already merged to `main`. If the user
explicitly asks for a temporary production debug deploy from an unmerged pushed
ref, use the workflow's explicit override and redeploy `main` after the fix is
merged:

```bash
gh workflow run deploy.yml -f environment=prod -f ref=<branch-or-sha> -f allow_unmerged_prod_ref=true
```

Fallback mechanism:

```bash
scripts/hetzner/github-actions-deploy.sh --sha <head-sha>
```

Both mechanisms exist. Use the GitHub Actions workflow by default when the
target branch/SHA has been pushed. Use the script fallback only from a shell
that has `FA_HETZNER_PROD_HOST` and `FA_HETZNER_DEPLOY_SSH_PRIVATE_KEY`.

### PROD Gate De-duplication

`pnpm run ci:prod` is the local one-shot production gate and already includes
`pnpm run ci`. Do not run `pnpm run ci` immediately before `pnpm run ci:prod`.

GitHub CI may split the same gate into `pnpm run ci` plus
`pnpm run ci:prod:extras` so Actions output stays readable without rerunning
normal CI.

Before a PROD deploy, prefer verifying that `ci.yml` already passed for the
exact deploy SHA. If no equivalent successful GitHub Actions gate exists for
that SHA, run `pnpm run ci:prod` once before deploying. Checked-in workflow
environment names for this verification must stay on the `FA_` env surface.

## Safety

- Never deploy any other project from this skill.
- Never use non-FA product env vars.
- Never commit service account keys or `.env.*.local`.
- Never deploy dirty worktree changes.
- Defaulting to DEV is intentional when no environment is provided.

## Final Response

Report:

- target environment
- branch
- commit SHA
- deploy mechanism used
- verification commands and results
- any blocker

# DEV public repository cutover

DEV serves `https://dev.fishing-assistant.online` from
`/home/pbuchman/deploy/fishing-assistant` on `home-dev`. When connecting from
another network, use the host's Tailscale name `home-dev` (MagicDNS), or its
confirmed full name `home-dev.taild6ad57.ts.net`. Do not substitute a changing
LAN address. The public application origin and edge routing stay unchanged.

The source is `https://github.com/pbuchman/fishing-assistant.git`. The retained
Firestore project is `fishing-knowledge-assistant`, database `(default)`.
This is a code/process cutover, **not a data migration**. Never run migrations,
migration 009, GCP bootstrap, Terraform apply, full knowledge sync, or reindexing
as part of this procedure. Preserve the migration ledger, existing Auth0 users,
provider credentials, embedding model and 2048 dimensions.

## Prepare and review (local checks)

Use a committed, pushed branch and pass `pnpm run ci:prod` plus GitHub Actions
before merging. Review both systemd units rendered by the following command;
rendering writes local files only. The node and pnpm paths must identify the
installed Node >=22.12.0 and pnpm 10.29.3. On the current host:

```bash
node scripts/dev-host/render-systemd.mjs \
  "$HOME/.local/state/fishing-assistant/reviewed-units" \
  /home/pbuchman \
  /home/pbuchman/.local/share/fnm/node-versions/v22.22.0/installation/bin/node \
  /home/pbuchman/.local/share/fnm/node-versions/v22.22.0/installation/bin/pnpm
systemd-analyze verify "$HOME/.local/state/fishing-assistant/reviewed-units/"*.service
```

Templates use explicit substitutions, never `%h` in a system unit with `User=`.
Both units pin the runtime PATH, deployment directory, PM2 home and host name.
The webhook's existing ignored file
`/home/pbuchman/tools/fa-webhook-handler/.env` retains its HMAC secret. Do not
copy its contents into units, documentation or Git. Inspect conflicting variable
names privately before installation; the file should supply the webhook secret,
not override deployment routing or tool paths.

## Pause automation and prepare the release (host and existing cloud)

A privileged operator must stop the webhook before merging/cutover. The old
application remains running at this point:

```bash
sudo systemctl stop fa-webhook-handler.service
```

Save the current unit files and `.pm2-fka/dump.pm2` outside Git with private
permissions. The installer also backs up existing system units under
`/var/backups/fishing-assistant/`. Do not delete the old deployment directory.

Merge the reviewed PR, fetch `origin/main`, and record its full SHA. Keep
administrative knowledge edits paused until the post-cutover comparison.
Capture a read-only fingerprint using the existing FA configuration:

```bash
mkdir -p "$HOME/.local/state/fishing-assistant/cutover"
chmod 700 "$HOME/.local/state/fishing-assistant/cutover"
direnv exec . node scripts/dev-host/snapshot-knowledge.mjs capture \
  "$HOME/.local/state/fishing-assistant/cutover/knowledge-before.json"
```

The snapshot contains document IDs and hashes, not Markdown or vectors. It
reads all knowledge nodes, pages and chunks from the configured live database.
It refuses to overwrite an earlier snapshot. Preserve that snapshot through
acceptance; an intentionally new cutover should use a new filename.

Prepare from the merged checkout while FKA still runs:

```bash
sha="$(git rev-parse origin/main)"
bash scripts/deploy/deploy-dev.sh --branch main --sha "$sha" --prepare-only
```

Preparation checks host/tools/configuration, rejects uncommitted or untracked
files in the deploy clone, fetches the explicit source, installs the frozen
lockfile, verifies runtime configuration, routing, auth, observability and the
existing data baseline, then builds. Ignored environment files are preserved.
`verify:env` is a static template check; `dev-setup` checks local configuration;
`verify:data-baseline` actually reads Firestore. None of these runs migrations.

Preparation records the SHA, checkout and built web artifact hash outside Git.
`apps/web/dist/version.json` contains only the repository name and SHA. It is
created after the build and must match the prepared artifact at activation.

## Check the existing edge before downtime

Before stopping FKA, check that the public homepage and `/index.html` return
HTTP 200 without credentials. The initial cutover on 2026-09-13 found a legacy
Caddy `basic_auth` matcher protecting those two paths. Activation correctly
failed the public smoke check and the operator restored FKA before retrying.

If this legacy gate is present, back up the FA-specific host Caddy site outside
Git and apply the existing `scripts/dev-host/caddy/fishing-assistant.Caddyfile`
snippet inside its current host block. Preserve the hostname, port and all other
hosted applications. Validate the complete Caddy configuration before reloading;
restore the backup if validation or reload fails. This synchronizes the edge
with the already checked-in public-homepage configuration. Auth0 and the block
on public internal API routes remain in place. Repeat the public smoke check
before beginning the process cutover.

## Install and switch (privileged host operations)

Approve the existing direnv loader as `pbuchman`, then install the reviewed
units from the committed checkout. Installation also copies the handler and
queue module to its stable runtime directory, without copying secrets. It does
not start or stop the application:

```bash
direnv allow /home/pbuchman/deploy/fishing-assistant
sudo bash scripts/dev-host/install-systemd.sh \
  /home/pbuchman/.local/state/fishing-assistant/reviewed-units
```

Check Node/pnpm with the PATH rendered in the units, without loading shell
startup files. Begin the agreed short interruption only after preparation passes:

```bash
sudo systemctl disable --now fka-pm2.service
lsof -nP -iTCP:3100 -iTCP:3201 -iTCP:3202 -iTCP:3203 -iTCP:3204 -sTCP:LISTEN
sudo systemctl start fa-pm2.service
```

The port check must show no old listeners before starting FA. If ports remain
occupied, identify their owner; do not stop unrelated applications. The new unit
activates the prepared SHA using the same deployment lock as webhook/manual
commands. DEV PM2 watch is disabled; the separate local ecosystem keeps its
watch behavior.

Activation checks all four backend health endpoints, public smoke tests, Auth0
preflight, the identities and directories of all five FA processes, and the
public version file. A healthy old process alone cannot prove activation.

## Acceptance (read-only except one chat)

- Verify public `/version.json` contains `pbuchman/fishing-assistant` and the
  selected SHA. Check root/app, four API health endpoints and blocked internal
  routes. Auth0 preflight is not a substitute for a real browser login.
- Log in with the existing `kontakt@pbuchman.com` account. Confirm the knowledge
  panel shows existing pages and one chat answer uses retained material and
  sources. This test can create conversation and usage records only; do not
  publish or modify knowledge.
- Compare the private snapshot from the same committed checkout/configuration:

```bash
direnv exec . node scripts/dev-host/snapshot-knowledge.mjs compare \
  "$HOME/.local/state/fishing-assistant/cutover/knowledge-before.json"
sudo systemctl restart fa-pm2.service
sudo systemctl enable fa-pm2.service
sudo systemctl enable --now fa-webhook-handler.service
systemctl is-enabled fka-pm2.service fa-pm2.service
```

Repeat version/health/process checks after restart. FKA must remain disabled.
Resume knowledge edits only after the hash comparison passes.

Redeliver an accepted main push using GitHub's webhook delivery UI/API. The
handler validates HMAC, repository identity, branch, deletion status and delivery
ID. `202` means a job was durably saved, not that deployment succeeded. Check
`jobs.json` under the private state directory and the journal for a final
`succeeded` status and actual SHA. Do not expose that directory via HTTP.
Delivery IDs can exceed JavaScript's safe integer range; preserve the exact ID
when using GitHub's API.

The queue processes one job at a time under a systemd-held OS lock. Manual and
automatic deployment share a second lock. Completed delivery IDs are not retried;
failed jobs are retried on redelivery. Interrupted jobs resume after handler
restart. Every automatic attempt resolves current public `main`, not the old
SHA in a delayed delivery; it rejects backwards/divergent history relative to
the last successfully activated release. A deliberate rollback is manual.
Reinstall the stable handler files when future changes modify the webhook or
queue implementation; normal app pushes only update the deployment checkout.

## Rollback (code and processes only)

Stop automation first. Do not restore or modify Firestore. Before the first
successful FA activation, the backed-up FKA unit/dump and untouched old checkout
can restore the previous runtime, although that old code is not equivalent to
FA reading `fa_*`. Once FA succeeds, retain its verified SHA as the code rollback
point. Prepare that explicitly selected commit from its known branch and
activate it manually, then repeat health/version/data checks before resuming
automation. Keep the retained configuration and key files unchanged.

If a preparation/build fails, do not activate. If activation fails, do not
report success based on HTTP 202 or ports alone. Preserve the private logs and
release state, diagnose the failure, and apply any code fix through a tested PR.

# Getting started

This guide has two paths. The source-check path installs dependencies and runs
the repository quality gate without application credentials. The full-runtime
path connects the application to cloud services and model providers that you
own. The full application is not an offline or credential-free setup.

## Prerequisites

For both paths:

- Node.js `>=22.12.0`
- pnpm `10.29.3`, matching the root `packageManager` field
- network access to the package registry during dependency installation

For the full runtime on a Unix-like development machine:

- `direnv` and `lsof`
- a shell that can run the checked-in Bash scripts
- the PM2 6 workspace dependency; a global PM2 install is not required
- a fresh, dedicated GCP project with billing configured and a Firestore Native
  mode database named `(default)`
- a service account and JSON key that can read and write the application's
  Firestore data and manage the Firestore indexes used by migrations
- an Auth0 tenant with a Single Page Application and an API
- an OpenRouter API key and a MiniMax API key; both are currently required when
  backend LLM providers initialize

Use a project dedicated to this application. The first migration sequence
includes migration 009, which clears the application's user, knowledge, chat,
and usage collections before establishing the current data baseline.

Official setup references:

- [Create and manage Firestore databases](https://cloud.google.com/firestore/docs/manage-databases)
- [Firestore IAM roles and permissions](https://cloud.google.com/firestore/docs/security/iam)
- [Create and delete service account keys](https://cloud.google.com/iam/docs/keys-create-delete)
- [Auth0 application settings](https://auth0.com/docs/get-started/applications/application-settings)
- [Auth0 custom claims](https://auth0.com/docs/secure/tokens/json-web-tokens/create-custom-claims)
- [Auth0 Actions overview](https://auth0.com/docs/customize/actions/actions-overview)
- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart)
- [MiniMax API prerequisites](https://platform.minimax.io/docs/guides/quickstart-preparation)

The repository does not define or claim a least-privilege IAM role set for a
new local administrator account. Choose grants from the official Firestore IAM
documentation that cover both application data operations and index deployment,
and review them for your environment.

## Check the source

Install the locked dependency graph and run the standard repository gate:

```bash
pnpm install --frozen-lockfile
pnpm run ci
```

No application credentials are required for this path. Installation still
contacts the package registry, and passing this gate does not mean the full app
can run without GCP, Auth0, or model-provider access.

Useful focused commands are:

```bash
pnpm run verify
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run format:check
```

The root `pnpm.overrides` section keeps audited transitive dependencies within
their existing major versions. The explicit `js-yaml@4` override selects
`4.3.2` instead of the `4.1.1` version pinned by PM2 6.

## Run the full application

### 1. Prepare a dedicated GCP data plane

Create a new GCP project and create its `(default)` database in Firestore Native
mode. The server SDK does not select a named database. Create a dedicated
service account with the data and index access required by this application,
then download its JSON key to a private location outside the repository. Keep
the key untracked and restrict its local file permissions.

Do not use Firestore, Storage, or Pub/Sub emulators. Local services connect to
the real project named by `FA_GCP_PROJECT_ID`.

This setup is manual. The repository's GCP bootstrap script targets the
existing Fishing Assistant infrastructure layout and is not a clean new-user
installer; its behavior and limitations are described under
[Maintainer operations](#maintainer-operations).

### 2. Configure Auth0

Create an Auth0 **Single Page Application** and an Auth0 API. Use the API
identifier as `FA_AUTH0_AUDIENCE`. In the SPA settings, configure the local
URLs exactly:

| Auth0 setting          | Local value                                |
| ---------------------- | ------------------------------------------ |
| Allowed Callback URLs  | `http://127.0.0.1:3100/app#/auth/callback` |
| Allowed Logout URLs    | `http://127.0.0.1:3100/#/home`             |
| Allowed Web Origins    | `http://127.0.0.1:3100`                    |
| Allowed Origins (CORS) | `http://127.0.0.1:3100`                    |

The application asks Auth0 for `openid profile email` and validates API access
tokens against the configured issuer, JWKS URI, and audience. Set:

```text
FA_AUTH0_DOMAIN=<tenant-domain-without-scheme>
FA_AUTH0_CLIENT_ID=<SPA-client-id>
FA_AUTH0_AUDIENCE=<API-identifier>
FA_AUTH0_ISSUER=https://<tenant-domain>/
FA_AUTH0_JWKS_URI=https://<tenant-domain>/.well-known/jwks.json
```

The user service requires `sub`, `email`, and `email_verified` in the API access
token. Auth0 API access tokens do not necessarily include email claims by
default, so attach a Login / Post Login Action that copies the verified user
profile values into the access token. The preferred claim names are:

```text
https://intexuraos.cloud/email
https://intexuraos.cloud/email_verified
https://intexuraos.cloud/name
```

The backend reads these namespaced claims first and accepts bare `email`,
`email_verified`, and `name` as a fallback. A minimal Post Login Action can use
the repository's expected namespace:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://intexuraos.cloud/';

  if (event.user.email) {
    api.accessToken.setCustomClaim(`${namespace}email`, event.user.email);
  }
  api.accessToken.setCustomClaim(`${namespace}email_verified`, event.user.email_verified === true);
  if (event.user.name) {
    api.accessToken.setCustomClaim(`${namespace}name`, event.user.name);
  }
};
```

Deploy the Action and add it to the Login flow. The namespace is an identifier;
Auth0 does not fetch that URL.

Also restrict new registrations in Auth0 to the same email policy that you put
in `FA_SIGNUP_ALLOWED_EMAIL_PATTERN`. For Auth0 database and passwordless
connections, a Pre User Registration Action can deny addresses that do not
match the policy. Auth0 documents that this trigger does not run for social
connections, so disable unneeded connections or apply an equivalent restriction
to every enabled signup path. The user service performs a second check before
it creates a brand-new ordinary account; this backend check is not a reason to
leave the Auth0 signup flow unrestricted.

Do not bypass Auth0 when diagnosing local login. The authorize request must use
the exact callback above, and the SPA origin must be present in both Web Origins
and CORS.

### 3. Create the local environment files

Copy the tracked templates manually:

```bash
cp .env.dev.example .env.dev.local
cp .envrc.example .envrc
```

Edit `.env.dev.local` and replace its placeholders with values from your own
accounts. Keep these local-runtime values even though the profile name is
`dev`:

```text
FA_ENVIRONMENT=dev
FA_DATA_PLANE=gcp
FA_BIND_HOST=127.0.0.1
FA_WEB_APP_URL=http://127.0.0.1:3100
FA_PUBLIC_ORIGIN=http://127.0.0.1:3100
```

In this repository, `local` means the current checkout and its PM2/Vite
processes. `dev` means the separately deployed `dev-host` environment. The
shared `.env.dev.example` shape deliberately keeps `FA_ENVIRONMENT=dev` for the
local profile, while the two origin values above must point to the local Vite
server.

At minimum, replace or set:

| Area              | Variables                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GCP               | `FA_GCP_PROJECT_ID`, `FA_GCP_PROJECT_NUMBER`, `FA_GCP_REGION`, `FA_GCP_ADMIN_SERVICE_ACCOUNT`, `FA_GCP_ADMIN_KEY_FILE` |
| Auth0 browser     | `FA_AUTH0_DOMAIN`, `FA_AUTH0_CLIENT_ID`, `FA_AUTH0_AUDIENCE`                                                           |
| Auth0 backend     | `FA_AUTH0_ISSUER`, `FA_AUTH0_JWKS_URI`                                                                                 |
| Account bootstrap | `FA_BOOTSTRAP_ADMIN_EMAILS`, `FA_SIGNUP_ALLOWED_EMAIL_PATTERN`                                                         |
| Internal calls    | `FA_INTERNAL_AUTH_TOKEN`                                                                                               |
| Providers         | `FA_OPENROUTER_APP_API_KEY`, `FA_MINIMAX_APP_API_KEY`                                                                  |

Use a long random value generated locally for `FA_INTERNAL_AUTH_TOKEN`. Escape
backslashes correctly when placing a regular expression in the env file. For
example, the template policy accepts only `example.com` addresses; replace it
with a policy for addresses you control.

Keep the checked-in service URL paths and internal loopback URLs unless you are
changing the local topology. Leave the embedding settings at:

```text
FA_EMBEDDING_PROVIDER=openrouter
FA_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
FA_EMBEDDING_DIMENSIONS=2048
```

The 2,048 dimension is part of the Firestore vector-index and stored-chunk
contract. A different value requires matching index changes and a complete
Knowledge Base reindex.

`.env.dev.local`, `.envrc`, `.envrc.local`, service-account keys, and other
secret-bearing files are ignored by Git. PM2 starts the web process with a
browser-safe environment subset; never add provider keys or
`FA_INTERNAL_AUTH_TOKEN` to browser code.

Allow the directory after reviewing `.envrc`:

```bash
direnv allow
```

### 4. Validate configuration and apply first migrations

First run the local file and value checks through `direnv exec .` so the
intended profile is loaded:

```bash
direnv exec . node scripts/dev-setup.mjs
```

`scripts/dev-setup.mjs` checks files, required values, the key-file path, and
the absence of emulator variables. It does not make a network call or prove
that the key can reach GCP.

The next command writes to your GCP project and deploys Firestore indexes. Run
it only against a fresh, dedicated data plane. **Migration 009 deletes the
application's knowledge, conversation, usage, and user collections** to
establish the current baseline:

```bash
direnv exec . pnpm run migrate
```

After migration, read the live `_migrations` ledger separately:

```bash
direnv exec . pnpm run migrate:status
```

Applied migration files are immutable: the ledger stores their checksums, and
checksum drift causes the runner to fail.

### 5. Start and verify services

Start the complete local stack:

```bash
direnv exec . pnpm run dev
```

The command validates configuration, regenerates service wiring, starts the
four Fastify services and Vite through the bundled PM2, then follows their
logs. Open `http://127.0.0.1:3100`.

After the services start, verify the chat health route in another shell:

```bash
curl --fail http://127.0.0.1:3100/api/chat/health
```

The response must report `status: ok`. Unlike `dev-setup.mjs`, the running chat
service health check includes Firestore, so this is the first documented check
that proves the local process can reach the configured database.

### 6. Bootstrap the first account

Set `FA_BOOTSTRAP_ADMIN_EMAILS` to the normalized email of the person who will
be the first administrator. That Auth0 identity must provide a verified email.
On first sign-in, complete the required first name, last name, and international
mobile number profile. A matching bootstrap identity then becomes an approved
administrator.

A brand-new ordinary user must match `FA_SIGNUP_ALLOWED_EMAIL_PATTERN` and
complete the same profile. The account then remains pending until an
administrator approves it. Existing-user email changes and bootstrap-admin
grants still require a verified Auth0 email.

## Local service commands

Use the full start command when you want attached logs:

```bash
direnv exec . pnpm run dev
```

Use these commands to manage the workspace's PM2 processes separately:

```bash
direnv exec . pnpm run services:start
direnv exec . pnpm run services:status
direnv exec . pnpm run services:logs
direnv exec . pnpm run services:restart
direnv exec . pnpm run services:stop
```

Web source and style edits refresh through Vite HMR. Backend source edits reload
through PM2 watch mode. Service wiring is regenerated by `pnpm run dev`.

After changing `apps/web/service-manifest.json`, run:

```bash
pnpm run generate:service-wiring
pnpm run verify:service-wiring
direnv exec . pnpm run services:restart
```

Restart services after changing `.env.dev.local`, `.envrc`, PM2 configuration,
dependencies, or service startup configuration. After lockfile changes, run
`pnpm install --frozen-lockfile` first. Production-shaped build entry points
are `pnpm run build:web`, `pnpm run build:services`, and `pnpm run build:prod`.

## Troubleshooting

### `dev-setup.mjs` reports placeholders or a missing key

Edit `.env.dev.local`; do not edit the tracked example. Confirm
`FA_GCP_ADMIN_KEY_FILE` is an absolute path or a `$HOME` path to a readable JSON
key outside the repository. The checker validates presence and readability,
not cloud permissions.

### Firestore health is down

Confirm the `(default)` Firestore database exists in the project, it uses Native
mode, and the service account has the required data access. Confirm the loaded
`FA_GCP_PROJECT_ID` matches the key's intended project. Remove inherited
`FIRESTORE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST`, and
`PUBSUB_EMULATOR_HOST`; this application does not support emulator-based local
runtime.

### Auth0 redirects or authorization fail

Inspect the authorize URL and its `redirect_uri`. It must request
`http://127.0.0.1:3100/app#/auth/callback`, and both the domain and client ID
must be present. Check the browser console and `/api/users` response. Verify the
SPA callback, Web Origin, CORS origin, issuer, JWKS URI, and audience, then
inspect a newly issued API access token for `sub`, email, and boolean
`email_verified` claims under the preferred namespace. Do not disable or bypass
authentication.

### A new user is rejected or stays pending

Confirm Auth0 passed the expected email claims and the address matches
`FA_SIGNUP_ALLOWED_EMAIL_PATTERN`. Only a verified bootstrap email becomes an
admin automatically after the required profile is complete. An ordinary new
account is expected to remain pending until admin approval.

### Publishing or chat fails at the model provider

Both `FA_OPENROUTER_APP_API_KEY` and `FA_MINIMAX_APP_API_KEY` must be present at
startup. Publishing uses OpenRouter embeddings even when a MiniMax chat route is
selected. Confirm the relevant provider account has access, credit, and a valid
key without printing the key into logs.

### A saved page does not appear in answers

Saving creates or updates a draft. Use **Publish page** and wait until the page
is marked **Current** for the assistant. Confirm its effective access includes
the test user. Use **Reindex page** if the published content is current but
retrieval is stale. A source link adds citation metadata; it does not import the
linked page.

## Maintainer operations

`pnpm run local:env:pull` is for maintainers of the original repository, not a
new adopter's setup path. By default it reads GitHub variables from
`pbuchman/fishing-assistant`, uses the project in `FA_GCP_PROJECT_ID` (whose
fallback is still a placeholder), and expects the original local admin-key
location. It reads Secret Manager values and can overwrite `.env.dev.local`
when called with `--force`.

The production and DEV automation is also specific to the existing
`fishing-assistant.online` domains and infrastructure. Use the
[runtime operations runbook](operations/fa-mvp-runbook.md) only after adapting
and reviewing that infrastructure. Current bootstrap limitations include:

- `terraform/gcp-data-plane/versions.tf` contains a placeholder GCS backend
  bucket. Backend initialization is separate from normal Terraform input
  variables.
- Terraform values such as project and bucket names are separate from the
  shell's `FA_` environment values; provide reviewed Terraform variables or a
  `terraform.tfvars` file rather than assuming the env file configures them.
- `scripts/bootstrap/bootstrap-gcp-data-plane.sh` requires an existing
  privileged service-account key. Even without `--apply`, it authenticates,
  enables APIs, creates the Terraform state bucket when absent, runs a
  Terraform plan, and reads live migration status. It is not a read-only dry
  run.
- `FA_SIGNUP_ALLOWED_EMAIL_PATTERN` is required at runtime but is absent from
  the current Terraform Secret Manager catalog. Maintainers must provision its
  secret and a secret version explicitly, along with versions for every other
  required catalog entry, before relying on secret-rendered deployments.

These constraints mean the checked-in production path is not a turnkey generic
self-hosting installer. Deployment commands, rollback, backups, and host layout
remain in the [runtime operations runbook](operations/fa-mvp-runbook.md), while
Grafana Cloud Loki, Alloy, and alert-router procedures remain in the
[observability runbook](operations/fa-observability-runbook.md).

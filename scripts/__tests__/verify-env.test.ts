import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateEnvRepository } from '../verify-env.mjs';

const foreignProductEnv = ['OTHERPRODUCT', 'TOKEN'].join('_');

const baseEnv = `FA_ENVIRONMENT=dev
FA_DATA_PLANE=gcp
FA_GCP_PROJECT_ID=replace-with-gcp-project-id
FA_GCP_PROJECT_NUMBER=replace-with-gcp-project-number
FA_GCP_REGION=europe-central2
FA_BIND_HOST=127.0.0.1
FA_GCP_ADMIN_SERVICE_ACCOUNT=replace-with-admin-service-account
FA_GCP_ADMIN_KEY_FILE=replace-with-local-fa-admin-key-path
FA_WEB_APP_URL=https://dev.fishing-assistant.online
FA_PUBLIC_ORIGIN=https://dev.fishing-assistant.online
FA_CHAT_SERVICE_URL=/api/chat
FA_KNOWLEDGE_SERVICE_URL=/api/knowledge
FA_LLM_USAGE_SERVICE_URL=/api/llm-usage
FA_USER_SERVICE_URL=/api/users
FA_CHAT_SERVICE_INTERNAL_URL=http://127.0.0.1:3201
FA_KNOWLEDGE_SERVICE_INTERNAL_URL=http://127.0.0.1:3202
FA_LLM_USAGE_SERVICE_INTERNAL_URL=http://127.0.0.1:3203
FA_USER_SERVICE_INTERNAL_URL=http://127.0.0.1:3204
FA_INTERNAL_AUTH_TOKEN=replace-with-local-generated-token
FA_INTERNAL_AUTH_TOKEN_PREVIOUS=
FA_SITE_BASIC_AUTH_USER=fa
FA_SITE_BASIC_AUTH_HTPASSWD=replace-with-secret-manager-htpasswd-line
FA_SITE_BASIC_AUTH_CADDY_HASH=replace-with-dev-caddy-password-hash
FA_SITE_BASIC_AUTH_CHECK_HEADER=replace-with-secret-manager-authorization-header
FA_AUTH0_DOMAIN=replace-with-auth0-domain
FA_AUTH0_CLIENT_ID=replace-with-auth0-spa-client-id
FA_AUTH0_AUDIENCE=replace-with-auth0-api-audience
FA_AUTH0_ISSUER=https://replace-with-auth0-domain/
FA_AUTH0_JWKS_URI=https://replace-with-auth0-domain/.well-known/jwks.json
FA_BOOTSTRAP_ADMIN_EMAILS=admin@example.com
FA_SIGNUP_ALLOWED_EMAIL_PATTERN=^[^@\\s]+@example\\.com$
FA_EMBEDDING_PROVIDER=openrouter
FA_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
FA_EMBEDDING_DIMENSIONS=2048
FA_OPENROUTER_APP_API_KEY=
FA_MINIMAX_APP_API_KEY=
FA_OPENAI_APP_API_KEY=
FA_GEMINI_APP_API_KEY=
FA_GRAFANA_LOKI_URL=
FA_GRAFANA_LOKI_USERNAME=
FA_GRAFANA_LOKI_TOKEN=
FA_GRAFANA_LOKI_DATASOURCE_UID=
FA_GRAFANA_INSTANCE_URL=
FA_ALERT_ROUTER_WEBHOOK_URL=
FA_ALERT_ROUTER_WEBHOOK_SECRET=
FA_ALERT_ROUTER_GITHUB_REPOSITORY=pbuchman/fishing-assistant
FA_ALERT_ROUTER_GITHUB_TOKEN=
FA_LOG_LEVEL=info
`;

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function withEnvFixture<T>(files: Record<string, string>, run: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-verify-env-'));

  try {
    writeFile(root, '.env.example', baseEnv);
    writeFile(root, '.env.dev.example', baseEnv);
    writeFile(
      root,
      '.env.prod.example',
      baseEnv.replace('FA_ENVIRONMENT=dev', 'FA_ENVIRONMENT=prod')
    );
    writeFile(
      root,
      '.envrc.example',
      'export GOOGLE_CLOUD_PROJECT="${FA_GCP_PROJECT_ID:-replace-with-gcp-project-id}"\nexport GOOGLE_APPLICATION_CREDENTIALS="${FA_GCP_ADMIN_KEY_FILE:-replace-with-local-fa-admin-key-path}"\nunset FIRESTORE_EMULATOR_HOST\nunset STORAGE_EMULATOR_HOST\nunset PUBSUB_EMULATOR_HOST\n'
    );
    writeFile(
      root,
      '.gitignore',
      '.env\n.env.*\n!.env.example\n!.env.*.example\n.envrc\n.envrc.local\n*-key.json\n*service-account*.json\ngcp-*.json\n'
    );

    for (const [relativePath, contents] of Object.entries(files)) {
      writeFile(root, relativePath, contents);
    }

    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('env verifier', () => {
  it('documents the Grafana observability env surface instead of Sentry', () => {
    for (const templatePath of ['.env.example', '.env.dev.example', '.env.prod.example']) {
      const source = readFileSync(templatePath, 'utf8');

      expect(source).toContain('FA_GRAFANA_LOKI_URL=');
      expect(source).toContain('FA_GRAFANA_LOKI_USERNAME=');
      expect(source).toContain('FA_GRAFANA_LOKI_TOKEN=');
      expect(source).toContain('FA_GRAFANA_LOKI_DATASOURCE_UID=');
      expect(source).toContain('FA_GRAFANA_INSTANCE_URL=');
      expect(source).toContain('FA_ALERT_ROUTER_WEBHOOK_URL=');
      expect(source).toContain('FA_ALERT_ROUTER_WEBHOOK_SECRET=');
      expect(source).toContain('FA_ALERT_ROUTER_GITHUB_REPOSITORY=pbuchman/fishing-assistant');
      expect(source).toContain('FA_ALERT_ROUTER_GITHUB_TOKEN=');
      expect(source).toContain('FA_LOG_LEVEL=info');
      expect(source).not.toContain('FA_SENTRY_DSN');
      expect(source).not.toContain('FA_SENTRY_DSN_WEB');
    }
  });

  it('documents the current-schema user-service env surface in committed templates', () => {
    for (const templatePath of ['.env.example', '.env.dev.example', '.env.prod.example']) {
      const source = readFileSync(templatePath, 'utf8');

      expect(source).toContain('FA_AUTH0_DOMAIN=');
      expect(source).toContain('FA_AUTH0_CLIENT_ID=');
      expect(source).toContain('FA_AUTH0_AUDIENCE=');
      expect(source).toContain('FA_AUTH0_ISSUER=');
      expect(source).toContain('FA_AUTH0_JWKS_URI=');
      expect(source).toContain('FA_BOOTSTRAP_ADMIN_EMAILS=');
      expect(source).toContain('FA_SIGNUP_ALLOWED_EMAIL_PATTERN=');
      expect(source).toContain('FA_USER_SERVICE_URL=/api/users');
      expect(source).toContain('FA_USER_SERVICE_INTERNAL_URL=http://127.0.0.1:3204');
      expect(source).toContain('FA_INTERNAL_AUTH_TOKEN_PREVIOUS=');
      expect(source).toContain('FA_SITE_BASIC_AUTH_USER=');
      expect(source).toContain('FA_SITE_BASIC_AUTH_HTPASSWD=');
      expect(source).toContain('FA_SITE_BASIC_AUTH_CADDY_HASH=');
      expect(source).toContain('FA_SITE_BASIC_AUTH_CHECK_HEADER=');
    }
  });

  it('accepts complete committed templates and FA-specific direnv wiring', () => {
    withEnvFixture({}, (root) => {
      expect(
        validateEnvRepository(root, {
          trackedFiles: [],
          liveEnv: {
            FA_GCP_ADMIN_KEY_FILE: '/keys/fa-admin-key.json',
            FA_GCP_PROJECT_ID: 'live-project',
            GOOGLE_APPLICATION_CREDENTIALS: '/keys/fa-admin-key.json',
            GOOGLE_CLOUD_PROJECT: 'live-project',
            GCLOUD_PROJECT: 'live-project',
            CLOUDSDK_CORE_PROJECT: 'live-project',
          },
        })
      ).toEqual([]);
    });
  });

  it('reports missing required variables and invalid GCP data-plane values', () => {
    withEnvFixture(
      {
        '.env.dev.example': baseEnv
          .replace('FA_DATA_PLANE=gcp', 'FA_DATA_PLANE=local')
          .replace('FA_GCP_PROJECT_ID=replace-with-gcp-project-id\n', '')
          .replace('FA_CHAT_SERVICE_INTERNAL_URL=http://127.0.0.1:3201\n', ''),
      },
      (root) => {
        expect(validateEnvRepository(root, { trackedFiles: [] })).toEqual(
          expect.arrayContaining([
            '.env.dev.example is missing FA_GCP_PROJECT_ID',
            '.env.dev.example is missing FA_CHAT_SERVICE_INTERNAL_URL',
            '.env.dev.example must set FA_DATA_PLANE=gcp',
          ])
        );
      }
    );
  });

  it('reports missing current-schema env values while keeping previous internal token optional', () => {
    withEnvFixture(
      {
        '.env.dev.example': baseEnv
          .replace('FA_AUTH0_ISSUER=https://replace-with-auth0-domain/\n', '')
          .replace('FA_USER_SERVICE_INTERNAL_URL=http://127.0.0.1:3204\n', '')
          .replace('FA_INTERNAL_AUTH_TOKEN_PREVIOUS=\n', ''),
      },
      (root) => {
        expect(validateEnvRepository(root, { trackedFiles: [] })).toEqual(
          expect.arrayContaining([
            '.env.dev.example is missing FA_AUTH0_ISSUER',
            '.env.dev.example is missing FA_USER_SERVICE_INTERNAL_URL',
          ])
        );
        expect(validateEnvRepository(root, { trackedFiles: [] })).not.toContain(
          '.env.dev.example is missing FA_INTERNAL_AUTH_TOKEN_PREVIOUS'
        );
      }
    );
  });

  it('rejects backend-only secrets in browser-safe env and tracked local secrets', () => {
    withEnvFixture({}, (root) => {
      expect(
        validateEnvRepository(root, {
          browserSafeVars: [
            'FA_PUBLIC_ORIGIN',
            'FA_AUTH0_DOMAIN',
            'FA_AUTH0_CLIENT_ID',
            'FA_AUTH0_AUDIENCE',
            'FA_USER_SERVICE_URL',
            'FA_AUTH0_ISSUER',
            'FA_AUTH0_JWKS_URI',
            'FA_BOOTSTRAP_ADMIN_EMAILS',
            'FA_USER_SERVICE_INTERNAL_URL',
            'FA_INTERNAL_AUTH_TOKEN',
            'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
            'FA_OPENAI_APP_API_KEY',
            'FA_SITE_BASIC_AUTH_USER',
            'FA_SITE_BASIC_AUTH_HTPASSWD',
            'FA_SITE_BASIC_AUTH_CADDY_HASH',
            'FA_SITE_BASIC_AUTH_CHECK_HEADER',
          ],
          trackedFiles: ['.env.dev.local', 'keys/runtime-key.json'],
        })
      ).toEqual(
        expect.arrayContaining([
          'Browser-safe env must not expose FA_INTERNAL_AUTH_TOKEN',
          'Browser-safe env must not expose FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
          'Browser-safe env must not expose FA_AUTH0_ISSUER',
          'Browser-safe env must not expose FA_AUTH0_JWKS_URI',
          'Browser-safe env must not expose FA_BOOTSTRAP_ADMIN_EMAILS',
          'Browser-safe env must not expose FA_USER_SERVICE_INTERNAL_URL',
          'Browser-safe env must not expose FA_OPENAI_APP_API_KEY',
          'Browser-safe env must not expose FA_SITE_BASIC_AUTH_USER',
          'Browser-safe env must not expose FA_SITE_BASIC_AUTH_HTPASSWD',
          'Browser-safe env must not expose FA_SITE_BASIC_AUTH_CADDY_HASH',
          'Browser-safe env must not expose FA_SITE_BASIC_AUTH_CHECK_HEADER',
          'Tracked local secret file is forbidden: .env.dev.local',
          'Tracked local secret file is forbidden: keys/runtime-key.json',
        ])
      );
    });
  });

  it('rejects non-FA product env references in scripts and living docs', () => {
    withEnvFixture(
      {
        'scripts/bad-env.mjs': `process.env.${foreignProductEnv};\n`,
        'docs/operations/reference.md': `process.env.${foreignProductEnv};\n`,
      },
      (root) => {
        expect(validateEnvRepository(root, { trackedFiles: [] })).toEqual(
          expect.arrayContaining([
            `Forbidden non-FA product env reference in scripts/bad-env.mjs: ${foreignProductEnv}`,
            `Forbidden non-FA product env reference in docs/operations/reference.md: ${foreignProductEnv}`,
          ])
        );
      }
    );
  });

  it('rejects retired Sentry env references in runtime env surfaces', () => {
    withEnvFixture(
      {
        'ecosystem.config.cjs': 'const value = process.env.FA_SENTRY_DSN_WEB;\n',
        'scripts/hetzner/load-secrets.sh': 'FA_RUNTIME_SECRETS=(\n  FA_SENTRY_DSN\n)\n',
        'docs/operations/fa-mvp-runbook.md':
          'Required Secret Manager entries:\n- `FA_SENTRY_DSN_WEB`\n',
      },
      (root) => {
        expect(validateEnvRepository(root, { trackedFiles: [] })).toEqual(
          expect.arrayContaining([
            'Forbidden Sentry env reference in ecosystem.config.cjs: FA_SENTRY_DSN_WEB',
            'Forbidden Sentry env reference in scripts/hetzner/load-secrets.sh: FA_SENTRY_DSN',
            'Forbidden Sentry env reference in docs/operations/fa-mvp-runbook.md: FA_SENTRY_DSN_WEB',
          ])
        );
      }
    );
  });

  it('rejects unsafe live environment variables inherited from other projects', () => {
    withEnvFixture({}, (root) => {
      expect(
        validateEnvRepository(root, {
          liveEnv: {
            FIRESTORE_EMULATOR_HOST: 'localhost:8080',
            FA_GCP_ADMIN_KEY_FILE: '/keys/fa-admin-key.json',
            FA_GCP_PROJECT_ID: 'fa-live-project',
            GOOGLE_APPLICATION_CREDENTIALS: '/keys/other-admin-key.json',
            GOOGLE_CLOUD_PROJECT: 'other-project',
            GCLOUD_PROJECT: 'other-project',
          },
          trackedFiles: [],
        })
      ).toEqual(
        expect.arrayContaining([
          'Live environment must not set FIRESTORE_EMULATOR_HOST',
          'Live GOOGLE_APPLICATION_CREDENTIALS must match FA_GCP_ADMIN_KEY_FILE',
          'Live GOOGLE_CLOUD_PROJECT must match FA_GCP_PROJECT_ID',
          'Live GCLOUD_PROJECT must match FA_GCP_PROJECT_ID',
        ])
      );
    });
  });

  it('rejects Google SDK project values that do not match the live FA project', () => {
    withEnvFixture({}, (root) => {
      expect(
        validateEnvRepository(root, {
          liveEnv: {
            FA_GCP_ADMIN_KEY_FILE: '/keys/fa-admin-key.json',
            FA_GCP_PROJECT_ID: 'fa-live-project',
            GOOGLE_APPLICATION_CREDENTIALS: '/keys/fa-admin-key.json',
            GOOGLE_CLOUD_PROJECT: 'other-project',
            GCLOUD_PROJECT: 'other-project',
            CLOUDSDK_CORE_PROJECT: 'other-project',
          },
          trackedFiles: [],
        })
      ).toEqual(
        expect.arrayContaining([
          'Live GOOGLE_CLOUD_PROJECT must match FA_GCP_PROJECT_ID',
          'Live GCLOUD_PROJECT must match FA_GCP_PROJECT_ID',
          'Live CLOUDSDK_CORE_PROJECT must match FA_GCP_PROJECT_ID',
        ])
      );
    });
  });

  it('rejects mismatched live FA admin key wiring', () => {
    withEnvFixture({}, (root) => {
      expect(
        validateEnvRepository(root, {
          liveEnv: {
            FA_GCP_ADMIN_KEY_FILE: '/keys/fa-admin-key.json',
            GOOGLE_APPLICATION_CREDENTIALS: '/keys/other-admin-key.json',
          },
          trackedFiles: [],
        })
      ).toEqual(
        expect.arrayContaining([
          'Live GOOGLE_APPLICATION_CREDENTIALS must match FA_GCP_ADMIN_KEY_FILE',
        ])
      );
    });
  });

  it('allows portable explicit FA admin key paths', () => {
    withEnvFixture({}, (root) => {
      expect(
        validateEnvRepository(root, {
          liveEnv: {
            FA_GCP_ADMIN_KEY_FILE: '/operator/keys/fa-admin-key.json',
            GOOGLE_APPLICATION_CREDENTIALS: '/operator/keys/fa-admin-key.json',
          },
          trackedFiles: [],
        })
      ).toEqual([]);
    });
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateLocalSetup } from '../dev-setup.mjs';

const validEnv = `FA_ENVIRONMENT=dev
FA_DATA_PLANE=gcp
FA_GCP_PROJECT_ID=example-fa-project
FA_GCP_PROJECT_NUMBER=123456789012
FA_GCP_REGION=europe-central2
FA_BIND_HOST=127.0.0.1
FA_GCP_ADMIN_SERVICE_ACCOUNT=fa-admin@example-fa-project.iam.gserviceaccount.com
FA_GCP_ADMIN_KEY_FILE=$HOME/.config/gcloud/fa-admin-key.json
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
FA_INTERNAL_AUTH_TOKEN=local-internal-token
FA_INTERNAL_AUTH_TOKEN_PREVIOUS=
FA_AUTH0_DOMAIN=fa-dev.example.auth0.com
FA_AUTH0_CLIENT_ID=local-spa-client-id
FA_AUTH0_AUDIENCE=https://api.dev.fishing-assistant.online
FA_AUTH0_ISSUER=https://fa-dev.example.auth0.com/
FA_AUTH0_JWKS_URI=https://fa-dev.example.auth0.com/.well-known/jwks.json
FA_BOOTSTRAP_ADMIN_EMAILS=operator@fishing-assistant.online
FA_SIGNUP_ALLOWED_EMAIL_PATTERN=^[^@\\s]+@example\\.com$
FA_EMBEDDING_PROVIDER=openrouter
FA_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
FA_EMBEDDING_DIMENSIONS=2048
FA_OPENROUTER_APP_API_KEY=local-openrouter-key
FA_MINIMAX_APP_API_KEY=local-minimax-key
FA_OPENAI_APP_API_KEY=
FA_GEMINI_APP_API_KEY=
FA_LOG_LEVEL=info
`;

function withLocalFixture<T>(
  files: Record<string, string>,
  run: (root: string, home: string) => T
): T {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-dev-setup-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fa-dev-setup-home-'));

  try {
    mkdirSync(path.join(home, '.config/gcloud'), { recursive: true });
    writeFileSync(path.join(home, '.config/gcloud/fa-admin-key.json'), '{}');

    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, contents);
    }

    return run(root, home);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

describe('local dev setup validator', () => {
  it('reports both ignored local env files when a checkout has not been initialized', () => {
    withLocalFixture({}, (root, home) => {
      expect(validateLocalSetup(root, { HOME: home })).toEqual(
        expect.arrayContaining(['.env.dev.local is missing', '.envrc is missing'])
      );
    });
  });

  it('accepts a local checkout configured for real FA GCP resources', () => {
    withLocalFixture(
      {
        '.env.dev.local': validEnv,
        '.envrc': 'dotenv .env.dev.local\nunset FIRESTORE_EMULATOR_HOST\n',
      },
      (root, home) => {
        expect(validateLocalSetup(root, { HOME: home })).toEqual([]);
      }
    );
  });

  it('rejects copied placeholders, the wrong data plane, and inherited emulators', () => {
    withLocalFixture(
      {
        '.env.dev.local': validEnv
          .replace('FA_DATA_PLANE=gcp', 'FA_DATA_PLANE=local')
          .replace('local-internal-token', 'replace-with-local-generated-token')
          .replace('local-openrouter-key', '')
          .replace('local-minimax-key', ''),
        '.envrc': 'dotenv .env.dev.local\n',
      },
      (root, home) => {
        expect(
          validateLocalSetup(root, {
            HOME: home,
            FIRESTORE_EMULATOR_HOST: 'localhost:8080',
          })
        ).toEqual(
          expect.arrayContaining([
            '.env.dev.local must set FA_DATA_PLANE=gcp',
            '.env.dev.local must set a real FA_INTERNAL_AUTH_TOKEN',
            '.env.dev.local must set FA_OPENROUTER_APP_API_KEY for the configured providers',
            '.env.dev.local must set FA_MINIMAX_APP_API_KEY for the configured providers',
            'Local runtime must not set FIRESTORE_EMULATOR_HOST',
          ])
        );
      }
    );
  });
});

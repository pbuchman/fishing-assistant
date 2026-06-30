import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localConfigPath = path.join(repoRoot, 'ecosystem.local.config.cjs');
const devConfigPath = path.join(repoRoot, 'ecosystem.config.cjs');
const generatedConfigPath = path.join(repoRoot, 'ecosystem.generated.cjs');
const prodConfigPath = path.join(repoRoot, 'ecosystem.config.prod.cjs');

interface GeneratedServiceUrls {
  FA_CHAT_SERVICE_URL: string;
  FA_KNOWLEDGE_SERVICE_URL: string;
  FA_LLM_USAGE_SERVICE_URL: string;
  FA_USER_SERVICE_URL: string;
}

interface GeneratedConfigExports {
  COMMON_SERVICE_URLS_GENERATED: GeneratedServiceUrls;
}

interface Pm2App {
  name: string;
  script?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  filter_env?: string[];
  ignore_watch?: string[];
  watch?: false | string[];
}

interface Pm2Config {
  apps: Pm2App[];
}

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();

  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    const value = env[key];

    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
}

function loadConfig(configPath: string): Pm2Config {
  const resolvedPath = require.resolve(configPath);
  Reflect.deleteProperty(require.cache, resolvedPath);

  try {
    return require(configPath) as Pm2Config;
  } finally {
    Reflect.deleteProperty(require.cache, resolvedPath);
  }
}

function withGeneratedServiceUrls<T>(urls: GeneratedServiceUrls, run: () => T): T {
  const resolvedPath = require.resolve(generatedConfigPath);
  const previousModule = require.cache[resolvedPath];
  const fakeModule = {
    children: [],
    exports: { COMMON_SERVICE_URLS_GENERATED: urls } satisfies GeneratedConfigExports,
    filename: resolvedPath,
    id: resolvedPath,
    isPreloading: false,
    loaded: true,
    parent: null,
    path: path.dirname(resolvedPath),
    paths: [],
    require,
  } as NodeJS.Module;

  require.cache[resolvedPath] = fakeModule;

  try {
    return run();
  } finally {
    if (previousModule === undefined) {
      Reflect.deleteProperty(require.cache, resolvedPath);
    } else {
      require.cache[resolvedPath] = previousModule;
    }
  }
}

function writeProdFixture(contents: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'fa-pm2-'));
  const filePath = path.join(directory, '.env.prod');
  writeFileSync(filePath, contents);

  return filePath;
}

describe('local PM2 config', () => {
  it('runs watched backend services and the Vite dev server for local self-refresh', () => {
    const config = withEnv(
      {
        FIRESTORE_EMULATOR_HOST: 'localhost:8080',
        NODE_OPTIONS: '--inspect',
        PUBSUB_EMULATOR_HOST: 'localhost:8085',
        STORAGE_EMULATOR_HOST: 'localhost:9199',
      },
      () => loadConfig(localConfigPath)
    );

    expect(config.apps.map((app) => app.name)).toEqual([
      'fa-llm-usage-service',
      'fa-knowledge-service',
      'fa-chat-service',
      'fa-user-service',
      'fa-web',
    ]);

    const backendApps = config.apps.filter((app) => app.name !== 'fa-web');
    for (const app of backendApps) {
      expect(app.watch).toEqual(['src']);
      expect(app.ignore_watch).toEqual(['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**']);
      expect(app.env).not.toHaveProperty('NODE_OPTIONS');
      expect(app.env).not.toHaveProperty('FIRESTORE_EMULATOR_HOST');
      expect(app.env).not.toHaveProperty('PUBSUB_EMULATOR_HOST');
      expect(app.env).not.toHaveProperty('STORAGE_EMULATOR_HOST');
    }

    const webApp = config.apps.find((app) => app.name === 'fa-web');
    expect(webApp?.script).toMatch(/scripts\/run-web-vite\.mjs$/);
    expect(webApp?.args).toEqual(['--host', '127.0.0.1', '--port', '3100']);
    expect(webApp?.args).not.toContain('preview');
    expect(webApp?.filter_env).toEqual(expect.arrayContaining(['FA_']));
  });
});

describe('development PM2 config', () => {
  it('defines the backend services and web process in start order with centralized ports', () => {
    const config = withEnv(
      {
        FIRESTORE_EMULATOR_HOST: 'localhost:8080',
        NODE_OPTIONS: '--inspect',
        PUBSUB_EMULATOR_HOST: 'localhost:8085',
        STORAGE_EMULATOR_HOST: 'localhost:9199',
      },
      () => loadConfig(devConfigPath)
    );

    expect(config.apps.map((app) => app.name)).toEqual([
      'fa-llm-usage-service',
      'fa-knowledge-service',
      'fa-chat-service',
      'fa-user-service',
      'fa-web',
    ]);

    expect(config.apps.map((app) => app.env?.['PORT'])).toEqual([
      '3203',
      '3202',
      '3201',
      '3204',
      undefined,
    ]);
    expect(config.apps.find((app) => app.name === 'fa-web')?.args).toEqual([
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '3100',
    ]);
    expect(config.apps.find((app) => app.name === 'fa-web')?.script).toMatch(
      /scripts\/run-web-vite\.mjs$/
    );
  });

  it('filters inherited product secrets out of the public web process', () => {
    const config = withEnv(
      {
        FA_INTERNAL_AUTH_TOKEN: 'internal-secret',
        FA_OPENROUTER_APP_API_KEY: 'provider-secret',
        FA_MINIMAX_APP_API_KEY: 'minimax-secret',
      },
      () => loadConfig(devConfigPath)
    );
    const webApp = config.apps.find((app) => app.name === 'fa-web');

    expect(webApp?.filter_env).toEqual(expect.arrayContaining(['FA_']));
    expect(webApp?.env).not.toHaveProperty('FA_INTERNAL_AUTH_TOKEN');
    expect(webApp?.env).not.toHaveProperty('FA_OPENROUTER_APP_API_KEY');
    expect(webApp?.env).not.toHaveProperty('FA_MINIMAX_APP_API_KEY');
  });

  it('uses dev backend watch settings without inherited node options or emulator vars', () => {
    const config = withEnv(
      {
        FIRESTORE_EMULATOR_HOST: 'localhost:8080',
        NODE_OPTIONS: '--inspect',
        PUBSUB_EMULATOR_HOST: 'localhost:8085',
        STORAGE_EMULATOR_HOST: 'localhost:9199',
      },
      () => loadConfig(devConfigPath)
    );
    const backendApps = config.apps.filter((app) => app.name !== 'fa-web');

    for (const app of backendApps) {
      expect(app.watch).toEqual(['src']);
      expect(app.ignore_watch).toEqual(['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**']);
      expect(app.args).toEqual(['src/index.ts']);
      expect(app.env).not.toHaveProperty('NODE_OPTIONS');
      expect(app.env).not.toHaveProperty('FIRESTORE_EMULATOR_HOST');
      expect(app.env).not.toHaveProperty('PUBSUB_EMULATOR_HOST');
      expect(app.env).not.toHaveProperty('STORAGE_EMULATOR_HOST');
    }
  });

  it('uses generated browser-facing service URL defaults', () => {
    const generatedUrls = {
      FA_CHAT_SERVICE_URL: '/generated/chat',
      FA_KNOWLEDGE_SERVICE_URL: '/generated/knowledge',
      FA_LLM_USAGE_SERVICE_URL: '/generated/llm-usage',
      FA_USER_SERVICE_URL: '/generated/users',
    };
    const config = withGeneratedServiceUrls(generatedUrls, () =>
      withEnv(
        {
          FA_CHAT_SERVICE_URL: undefined,
          FA_KNOWLEDGE_SERVICE_URL: undefined,
          FA_LLM_USAGE_SERVICE_URL: undefined,
          FA_USER_SERVICE_URL: undefined,
        },
        () => loadConfig(devConfigPath)
      )
    );

    for (const app of config.apps) {
      expect(app.env?.['FA_CHAT_SERVICE_URL']).toBe(generatedUrls.FA_CHAT_SERVICE_URL);
      expect(app.env?.['FA_KNOWLEDGE_SERVICE_URL']).toBe(generatedUrls.FA_KNOWLEDGE_SERVICE_URL);
      expect(app.env?.['FA_LLM_USAGE_SERVICE_URL']).toBe(generatedUrls.FA_LLM_USAGE_SERVICE_URL);
      expect(app.env?.['FA_USER_SERVICE_URL']).toBe(generatedUrls.FA_USER_SERVICE_URL);
    }
  });

  it('pins Google SDK compatibility env to FA dev values', () => {
    const config = withEnv(
      {
        CLOUDSDK_COMPUTE_REGION: 'wrong-region',
        CLOUDSDK_CORE_PROJECT: 'wrong-core-project',
        FA_GCP_ADMIN_KEY_FILE: '/fa/dev-admin-key.json',
        FA_GCP_PROJECT_ID: 'fa-dev-project',
        FA_GCP_REGION: 'europe-dev1',
        GCLOUD_PROJECT: 'wrong-gcloud-project',
        GOOGLE_APPLICATION_CREDENTIALS: '/wrong/inherited-key.json',
        GOOGLE_CLOUD_PROJECT: 'wrong-google-project',
      },
      () => loadConfig(devConfigPath)
    );
    const serviceEnv = config.apps[0]?.env;

    expect(serviceEnv?.['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/fa/dev-admin-key.json');
    expect(serviceEnv?.['GOOGLE_CLOUD_PROJECT']).toBe('fa-dev-project');
    expect(serviceEnv?.['GCLOUD_PROJECT']).toBe('fa-dev-project');
    expect(serviceEnv?.['CLOUDSDK_CORE_PROJECT']).toBe('fa-dev-project');
    expect(serviceEnv?.['CLOUDSDK_COMPUTE_REGION']).toBe('europe-dev1');
  });
});

describe('production PM2 config', () => {
  it('defines only backend services with production bind host', () => {
    const fixturePath = writeProdFixture('FA_ENVIRONMENT=prod\nFA_BIND_HOST=0.0.0.0\n');

    try {
      const config = withEnv({ FA_PROD_ENV_FILE: fixturePath }, () => loadConfig(prodConfigPath));

      expect(config.apps.map((app) => app.name)).toEqual([
        'fa-llm-usage-service',
        'fa-knowledge-service',
        'fa-chat-service',
        'fa-user-service',
      ]);
      expect(config.apps.map((app) => app.env?.['PORT'])).toEqual(['3203', '3202', '3201', '3204']);

      for (const app of config.apps) {
        expect(app.watch).toBe(false);
        expect(app.env?.['FA_BIND_HOST']).toBe('0.0.0.0');
      }
    } finally {
      rmSync(path.dirname(fixturePath), { recursive: true, force: true });
    }
  });

  it('uses generated browser-facing service URL defaults', () => {
    const generatedUrls = {
      FA_CHAT_SERVICE_URL: '/generated/prod-chat',
      FA_KNOWLEDGE_SERVICE_URL: '/generated/prod-knowledge',
      FA_LLM_USAGE_SERVICE_URL: '/generated/prod-llm-usage',
      FA_USER_SERVICE_URL: '/generated/prod-users',
    };
    const fixturePath = writeProdFixture('FA_ENVIRONMENT=prod\nFA_BIND_HOST=0.0.0.0\n');

    try {
      const config = withGeneratedServiceUrls(generatedUrls, () =>
        withEnv(
          {
            FA_CHAT_SERVICE_URL: undefined,
            FA_KNOWLEDGE_SERVICE_URL: undefined,
            FA_LLM_USAGE_SERVICE_URL: undefined,
            FA_USER_SERVICE_URL: undefined,
            FA_PROD_ENV_FILE: fixturePath,
          },
          () => loadConfig(prodConfigPath)
        )
      );

      for (const app of config.apps) {
        expect(app.env?.['FA_CHAT_SERVICE_URL']).toBe(generatedUrls.FA_CHAT_SERVICE_URL);
        expect(app.env?.['FA_KNOWLEDGE_SERVICE_URL']).toBe(generatedUrls.FA_KNOWLEDGE_SERVICE_URL);
        expect(app.env?.['FA_LLM_USAGE_SERVICE_URL']).toBe(generatedUrls.FA_LLM_USAGE_SERVICE_URL);
        expect(app.env?.['FA_USER_SERVICE_URL']).toBe(generatedUrls.FA_USER_SERVICE_URL);
      }
    } finally {
      rmSync(path.dirname(fixturePath), { recursive: true, force: true });
    }
  });

  it('pins Google SDK compatibility env to FA production values', () => {
    const fixturePath = writeProdFixture(
      [
        'FA_ENVIRONMENT=prod',
        'FA_BIND_HOST=0.0.0.0',
        'FA_GCP_PROJECT_ID=fa-prod-project',
        'FA_GCP_REGION=europe-prod1',
      ].join('\n')
    );

    try {
      const config = withEnv(
        {
          CLOUDSDK_COMPUTE_REGION: 'wrong-region',
          CLOUDSDK_CORE_PROJECT: 'wrong-core-project',
          FA_PROD_ENV_FILE: fixturePath,
          GCLOUD_PROJECT: 'wrong-gcloud-project',
          GOOGLE_APPLICATION_CREDENTIALS: '/wrong/inherited-key.json',
          GOOGLE_CLOUD_PROJECT: 'wrong-google-project',
        },
        () => loadConfig(prodConfigPath)
      );
      const serviceEnv = config.apps[0]?.env;

      expect(serviceEnv?.['GOOGLE_APPLICATION_CREDENTIALS']).toBe(
        '/run/secrets/fa-runtime-sa-key.json'
      );
      expect(serviceEnv?.['GOOGLE_CLOUD_PROJECT']).toBe('fa-prod-project');
      expect(serviceEnv?.['GCLOUD_PROJECT']).toBe('fa-prod-project');
      expect(serviceEnv?.['CLOUDSDK_CORE_PROJECT']).toBe('fa-prod-project');
      expect(serviceEnv?.['CLOUDSDK_COMPUTE_REGION']).toBe('europe-prod1');
    } finally {
      rmSync(path.dirname(fixturePath), { recursive: true, force: true });
    }
  });

  it('rejects non-production environment values', () => {
    const fixturePath = writeProdFixture('FA_ENVIRONMENT=dev\nFA_BIND_HOST=0.0.0.0\n');

    try {
      expect(() =>
        withEnv({ FA_PROD_ENV_FILE: fixturePath }, () => loadConfig(prodConfigPath))
      ).toThrow('Refusing to start PM2 without FA_ENVIRONMENT=prod');
    } finally {
      rmSync(path.dirname(fixturePath), { recursive: true, force: true });
    }
  });
});

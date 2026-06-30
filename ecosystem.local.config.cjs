const path = require('node:path');
const { COMMON_SERVICE_URLS_GENERATED } = require('./ecosystem.generated.cjs');

const SERVICES = [
  {
    serviceName: 'llm-usage-service',
    pm2Name: 'fa-llm-usage-service',
    cwd: './apps/llm-usage-service',
    port: 3203,
  },
  {
    serviceName: 'knowledge-service',
    pm2Name: 'fa-knowledge-service',
    cwd: './apps/knowledge-service',
    port: 3202,
  },
  {
    serviceName: 'chat-service',
    pm2Name: 'fa-chat-service',
    cwd: './apps/chat-service',
    port: 3201,
  },
  {
    serviceName: 'user-service',
    pm2Name: 'fa-user-service',
    cwd: './apps/user-service',
    port: 3204,
  },
];

const TSX_CLI = path.resolve(__dirname, 'node_modules/tsx/dist/cli.mjs');
const WEB_VITE_CLI = path.resolve(__dirname, 'scripts/run-web-vite.mjs');
const DEFAULT_FA_GCP_ADMIN_KEY_FILE = path.join(
  process.env.HOME ?? '.',
  '.config/gcloud/fa-admin-key.json'
);
const OMITTED_INHERITED_ENV = new Set([
  'FIRESTORE_EMULATOR_HOST',
  'NODE_OPTIONS',
  'PUBSUB_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST',
]);

function inheritedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !OMITTED_INHERITED_ENV.has(key))
  );
}

function envValue(key, fallback) {
  return process.env[key] ?? fallback;
}

function generatedServiceUrl(key) {
  return envValue(key, COMMON_SERVICE_URLS_GENERATED[key]);
}

const FA_GCP_PROJECT_ID = envValue('FA_GCP_PROJECT_ID', 'replace-with-gcp-project-id');
const FA_GCP_REGION = envValue('FA_GCP_REGION', 'europe-central2');
const FA_GCP_ADMIN_KEY_FILE = envValue('FA_GCP_ADMIN_KEY_FILE', DEFAULT_FA_GCP_ADMIN_KEY_FILE);

const COMMON_SERVICE_ENV = {
  ...inheritedEnv(),
  NODE_ENV: 'development',
  FA_ENVIRONMENT: envValue('FA_ENVIRONMENT', 'dev'),
  FA_GCP_PROJECT_ID,
  FA_GCP_PROJECT_NUMBER: envValue('FA_GCP_PROJECT_NUMBER', 'replace-with-gcp-project-number'),
  FA_GCP_REGION,
  FA_DATA_PLANE: envValue('FA_DATA_PLANE', 'gcp'),
  FA_BIND_HOST: envValue('FA_BIND_HOST', '127.0.0.1'),
  FA_WEB_APP_URL: envValue('FA_WEB_APP_URL', 'https://dev.fishing-assistant.online'),
  FA_PUBLIC_ORIGIN: envValue('FA_PUBLIC_ORIGIN', 'https://dev.fishing-assistant.online'),
  FA_CHAT_SERVICE_URL: generatedServiceUrl('FA_CHAT_SERVICE_URL'),
  FA_KNOWLEDGE_SERVICE_URL: generatedServiceUrl('FA_KNOWLEDGE_SERVICE_URL'),
  FA_LLM_USAGE_SERVICE_URL: generatedServiceUrl('FA_LLM_USAGE_SERVICE_URL'),
  FA_USER_SERVICE_URL: generatedServiceUrl('FA_USER_SERVICE_URL'),
  FA_CHAT_SERVICE_INTERNAL_URL: envValue('FA_CHAT_SERVICE_INTERNAL_URL', 'http://127.0.0.1:3201'),
  FA_KNOWLEDGE_SERVICE_INTERNAL_URL: envValue(
    'FA_KNOWLEDGE_SERVICE_INTERNAL_URL',
    'http://127.0.0.1:3202'
  ),
  FA_LLM_USAGE_SERVICE_INTERNAL_URL: envValue(
    'FA_LLM_USAGE_SERVICE_INTERNAL_URL',
    'http://127.0.0.1:3203'
  ),
  FA_USER_SERVICE_INTERNAL_URL: envValue('FA_USER_SERVICE_INTERNAL_URL', 'http://127.0.0.1:3204'),
  FA_INTERNAL_AUTH_TOKEN: process.env.FA_INTERNAL_AUTH_TOKEN,
  FA_INTERNAL_AUTH_TOKEN_PREVIOUS: process.env.FA_INTERNAL_AUTH_TOKEN_PREVIOUS,
  FA_AUTH0_DOMAIN: process.env.FA_AUTH0_DOMAIN,
  FA_AUTH0_CLIENT_ID: process.env.FA_AUTH0_CLIENT_ID,
  FA_AUTH0_AUDIENCE: process.env.FA_AUTH0_AUDIENCE,
  FA_AUTH0_ISSUER: process.env.FA_AUTH0_ISSUER,
  FA_AUTH0_JWKS_URI: process.env.FA_AUTH0_JWKS_URI,
  FA_BOOTSTRAP_ADMIN_EMAILS: process.env.FA_BOOTSTRAP_ADMIN_EMAILS,
  FA_OPENROUTER_APP_API_KEY: process.env.FA_OPENROUTER_APP_API_KEY,
  FA_MINIMAX_APP_API_KEY: process.env.FA_MINIMAX_APP_API_KEY,
  FA_OPENAI_APP_API_KEY: process.env.FA_OPENAI_APP_API_KEY,
  FA_GEMINI_APP_API_KEY: process.env.FA_GEMINI_APP_API_KEY,
  FA_LOG_LEVEL: envValue('FA_LOG_LEVEL', 'info'),
  GOOGLE_APPLICATION_CREDENTIALS: FA_GCP_ADMIN_KEY_FILE,
  GOOGLE_CLOUD_PROJECT: FA_GCP_PROJECT_ID,
  GCLOUD_PROJECT: FA_GCP_PROJECT_ID,
  CLOUDSDK_CORE_PROJECT: FA_GCP_PROJECT_ID,
  CLOUDSDK_COMPUTE_REGION: FA_GCP_REGION,
};

const SERVICE_ENV = {
  'chat-service': {},
  'knowledge-service': {
    FA_EMBEDDING_PROVIDER: envValue('FA_EMBEDDING_PROVIDER', 'openrouter'),
    FA_EMBEDDING_MODEL: envValue('FA_EMBEDDING_MODEL', 'qwen/qwen3-embedding-8b'),
    FA_EMBEDDING_DIMENSIONS: envValue('FA_EMBEDDING_DIMENSIONS', '2048'),
  },
};

const WEB_ENV = {
  NODE_ENV: 'development',
  FA_ENVIRONMENT: envValue('FA_ENVIRONMENT', 'dev'),
  FA_WEB_APP_URL: envValue('FA_WEB_APP_URL', 'https://dev.fishing-assistant.online'),
  FA_PUBLIC_ORIGIN: envValue('FA_PUBLIC_ORIGIN', 'https://dev.fishing-assistant.online'),
  FA_CHAT_SERVICE_URL: generatedServiceUrl('FA_CHAT_SERVICE_URL'),
  FA_KNOWLEDGE_SERVICE_URL: generatedServiceUrl('FA_KNOWLEDGE_SERVICE_URL'),
  FA_LLM_USAGE_SERVICE_URL: generatedServiceUrl('FA_LLM_USAGE_SERVICE_URL'),
  FA_USER_SERVICE_URL: generatedServiceUrl('FA_USER_SERVICE_URL'),
  FA_AUTH0_DOMAIN: process.env.FA_AUTH0_DOMAIN,
  FA_AUTH0_CLIENT_ID: process.env.FA_AUTH0_CLIENT_ID,
  FA_AUTH0_AUDIENCE: process.env.FA_AUTH0_AUDIENCE,
};

function createServiceConfig(service) {
  return {
    name: service.pm2Name,
    cwd: service.cwd,
    script: TSX_CLI,
    args: ['src/index.ts'],
    interpreter: 'node',
    env: {
      ...COMMON_SERVICE_ENV,
      ...(SERVICE_ENV[service.serviceName] ?? {}),
      PORT: String(service.port),
    },
    autorestart: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    watch: ['src'],
    ignore_watch: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
    watch_delay: 1000,
  };
}

module.exports = {
  apps: [
    ...SERVICES.map((service) => createServiceConfig(service)),
    {
      name: 'fa-web',
      cwd: './apps/web',
      script: WEB_VITE_CLI,
      args: ['--host', '127.0.0.1', '--port', '3100'],
      interpreter: 'node',
      filter_env: ['FA_', 'GOOGLE_', 'GCLOUD_', 'CLOUDSDK_'],
      env: WEB_ENV,
    },
  ],
};

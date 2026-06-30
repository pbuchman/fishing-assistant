const fs = require('node:fs');
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

const ENV_FILE = process.env.FA_PROD_ENV_FILE ?? '/etc/fa/.env.prod';
const DEFAULT_RUNTIME_SERVICE_ACCOUNT_KEY_FILE = '/run/secrets/fa-runtime-sa-key.json';
const OMITTED_INHERITED_ENV = new Set([
  'FIRESTORE_EMULATOR_HOST',
  'NODE_OPTIONS',
  'PUBSUB_EMULATOR_HOST',
  'STORAGE_EMULATOR_HOST',
]);

function loadDotenv() {
  try {
    return require('dotenv');
  } catch {
    return undefined;
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const dotenv = loadDotenv();

  if (dotenv !== undefined) {
    return dotenv.parse(contents);
  }

  return Object.fromEntries(
    contents
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      })
      .filter(([key]) => key !== '')
  );
}

const FILE_ENV = parseEnvFile(ENV_FILE);
const RUNTIME_ENV = { ...process.env, ...FILE_ENV };

function envValue(key, fallback) {
  return RUNTIME_ENV[key] ?? fallback;
}

function fileEnvValue(key, fallback) {
  return FILE_ENV[key] ?? fallback;
}

function generatedServiceUrl(key) {
  return envValue(key, COMMON_SERVICE_URLS_GENERATED[key]);
}

function inheritedEnv() {
  return Object.fromEntries(
    Object.entries(RUNTIME_ENV).filter(([key]) => !OMITTED_INHERITED_ENV.has(key))
  );
}

if (envValue('FA_ENVIRONMENT') !== 'prod') {
  throw new Error('Refusing to start PM2 without FA_ENVIRONMENT=prod');
}

if (envValue('FA_BIND_HOST') !== '0.0.0.0') {
  throw new Error('Refusing to start production PM2 without FA_BIND_HOST=0.0.0.0');
}

const FA_GCP_PROJECT_ID = envValue('FA_GCP_PROJECT_ID', 'fishing-assistant');
const FA_GCP_REGION = envValue('FA_GCP_REGION', 'europe-central2');

const COMMON_SERVICE_ENV = {
  ...inheritedEnv(),
  NODE_ENV: 'production',
  FA_ENVIRONMENT: 'prod',
  FA_GCP_PROJECT_ID,
  FA_GCP_REGION,
  FA_DATA_PLANE: envValue('FA_DATA_PLANE', 'gcp'),
  FA_BIND_HOST: '0.0.0.0',
  FA_WEB_APP_URL: envValue('FA_WEB_APP_URL', 'https://fishing-assistant.online'),
  FA_PUBLIC_ORIGIN: envValue('FA_PUBLIC_ORIGIN', 'https://fishing-assistant.online'),
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
  FA_INTERNAL_AUTH_TOKEN: envValue('FA_INTERNAL_AUTH_TOKEN'),
  FA_INTERNAL_AUTH_TOKEN_PREVIOUS: envValue('FA_INTERNAL_AUTH_TOKEN_PREVIOUS'),
  FA_AUTH0_DOMAIN: envValue('FA_AUTH0_DOMAIN'),
  FA_AUTH0_CLIENT_ID: envValue('FA_AUTH0_CLIENT_ID'),
  FA_AUTH0_AUDIENCE: envValue('FA_AUTH0_AUDIENCE'),
  FA_AUTH0_ISSUER: envValue('FA_AUTH0_ISSUER'),
  FA_AUTH0_JWKS_URI: envValue('FA_AUTH0_JWKS_URI'),
  FA_BOOTSTRAP_ADMIN_EMAILS: envValue('FA_BOOTSTRAP_ADMIN_EMAILS'),
  FA_OPENROUTER_APP_API_KEY: envValue('FA_OPENROUTER_APP_API_KEY'),
  FA_MINIMAX_APP_API_KEY: envValue('FA_MINIMAX_APP_API_KEY'),
  FA_OPENAI_APP_API_KEY: envValue('FA_OPENAI_APP_API_KEY'),
  FA_GEMINI_APP_API_KEY: envValue('FA_GEMINI_APP_API_KEY'),
  GOOGLE_APPLICATION_CREDENTIALS: fileEnvValue(
    'GOOGLE_APPLICATION_CREDENTIALS',
    DEFAULT_RUNTIME_SERVICE_ACCOUNT_KEY_FILE
  ),
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

function createServiceConfig(service) {
  return {
    name: service.pm2Name,
    cwd: service.cwd,
    script: path.resolve(__dirname, service.cwd, 'dist/index.js'),
    interpreter: 'node',
    env: {
      ...COMMON_SERVICE_ENV,
      ...(SERVICE_ENV[service.serviceName] ?? {}),
      PORT: String(service.port),
    },
    autorestart: true,
    kill_timeout: 5000,
    restart_delay: 5000,
    watch: false,
  };
}

module.exports = {
  apps: SERVICES.map((service) => createServiceConfig(service)),
};

import { serializeError } from '@fa/common-core';
import pino, { type DestinationStream, type Logger } from 'pino';

const REDACTED_VALUE = '[REDACTED]';
const sensitiveKeyPattern =
  /(authorization|internal[_-]?auth|api[_-]?key|private[_-]?key|key[_-]?file|token|secret|credentials|service[_-]?account|gcp[_-]?admin[_-]?key[_-]?file)/i;
const normalizedSensitiveKeys = new Set([
  'actoruserid',
  'approvedby',
  'auth0subject',
  'avatar',
  'avatarurl',
  'citation',
  'citations',
  'createdby',
  'currentuserid',
  'displayname',
  'email',
  'evidence',
  'firstname',
  'fullname',
  'lastname',
  'mobilenumber',
  'name',
  'nickname',
  'phone',
  'phonenumber',
  'picture',
  'pictureurl',
  'profile',
  'prompt',
  'rejectedby',
  'sourcetext',
  'sourcecontent',
  'sub',
  'subject',
  'suspendedby',
  'systemprompt',
  'targetuserid',
  'updatedby',
  'userid',
  'userprompt',
]);
const auth0SubjectPattern = /\bauth0\|[A-Za-z0-9._~:/=-]+\b/u;
const bearerTokenPattern = /\bBearer\s+\S{8,}/iu;
const emailLikePattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/u;
const e164LikePattern = /\+[1-9]\d{7,14}\b/u;
const internalAuthAssignmentPattern =
  /\b(?:FA_[A-Z0-9_]*?(?:TOKEN|SECRET|API[_-]?KEY)|X-Internal-Auth)\s*[:=]\s*\S+/iu;
const promptLikeValuePattern =
  /\b(?:prompt|evidence|citations?|source[_\s-]?(?:text|content)|sourceText|sourceContent)\s*[:=]/iu;
const providerKeyPattern = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/u;
const serviceAccountKeyPathPattern =
  /(?:\/|\$HOME\/|~\/)[^\s]*?(?:keys\/[^\s]*\.json|[^\s/]*key[^\s/]*\.json)\b/u;
const supportedLevels = ['silent', 'debug', 'info', 'warn', 'error'] as const;
const supportedLevelSet = new Set<string>(supportedLevels);

export type ServiceLogLevel = (typeof supportedLevels)[number];

function normalizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  return (
    sensitiveKeyPattern.test(key) ||
    normalizedSensitiveKeys.has(normalized) ||
    normalized.includes('prompt') ||
    normalized.includes('evidence') ||
    normalized.includes('citation') ||
    normalized.includes('sourcetext') ||
    normalized.includes('sourcecontent')
  );
}

function isJwtLikeString(value: string): boolean {
  const token = /^Bearer\s+(.+)$/iu.exec(value.trim())?.[1] ?? value.trim();

  return /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{3,}$/u.test(token);
}

function isSensitiveString(value: string): boolean {
  return (
    isJwtLikeString(value) ||
    bearerTokenPattern.test(value) ||
    emailLikePattern.test(value) ||
    e164LikePattern.test(value) ||
    auth0SubjectPattern.test(value) ||
    internalAuthAssignmentPattern.test(value) ||
    promptLikeValuePattern.test(value) ||
    providerKeyPattern.test(value) ||
    serviceAccountKeyPathPattern.test(value)
  );
}

function redactMetadataValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    try {
      return value.map((item) => redactMetadataValue(item, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (typeof value === 'string') {
    return isSensitiveString(value) ? REDACTED_VALUE : value;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  try {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveKey(key) ? REDACTED_VALUE : redactMetadataValue(nested, seen),
      ])
    );
  } finally {
    seen.delete(value);
  }
}

export function redactMetadata(value: unknown): unknown {
  return redactMetadataValue(value, new WeakSet<object>());
}

function redactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactMetadata(record);
  return redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}

export function getServiceLogLevel(env: NodeJS.ProcessEnv = process.env): ServiceLogLevel {
  if (env['NODE_ENV'] === 'test') {
    return 'silent';
  }

  const configured = env['FA_LOG_LEVEL'];
  return configured !== undefined && supportedLevelSet.has(configured)
    ? (configured as ServiceLogLevel)
    : 'info';
}

export function createAppLogger(input: {
  service: string;
  environment?: string | undefined;
  sha?: string | undefined;
  level?: ServiceLogLevel | undefined;
  destination?: DestinationStream | undefined;
}): Logger {
  const level = input.level ?? getServiceLogLevel();

  return pino(
    {
      level,
      base: {
        app: 'fishing-assistant',
        service: input.service,
        env: input.environment ?? process.env['FA_ENVIRONMENT'] ?? 'unknown',
        ...(input.sha !== undefined ? { sha: input.sha } : {}),
      },
      formatters: {
        level: (label) => ({ level: label }),
        log: redactLogRecord,
      },
      serializers: {
        err: serializeError,
        error: serializeError,
        req: redactMetadata,
        res: redactMetadata,
      },
    },
    input.destination
  );
}

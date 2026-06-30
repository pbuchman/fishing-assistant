import type { FastifyInstance } from 'fastify';

type HeaderValue = string | number | readonly string[] | undefined;
type HeaderSource = Record<string, HeaderValue>;

export const REDACTED_HEADER_VALUE = '[REDACTED]';

const exactSensitiveHeaders = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-internal-auth',
  'x-openrouter-api-key',
  'x-openai-api-key',
  'x-gemini-api-key',
]);

const normalizedSensitiveFields = new Set([
  'accesstoken',
  'apikey',
  'aud',
  'audience',
  'auth0subject',
  'authorization',
  'clientsecret',
  'cookie',
  'email',
  'emailverified',
  'familyname',
  'givenname',
  'idtoken',
  'internalauth',
  'internalauthtoken',
  'iss',
  'issuer',
  'jwks',
  'jwksuri',
  'jwksurl',
  'jwt',
  'mobilenumber',
  'name',
  'nickname',
  'password',
  'phone',
  'picture',
  'providerapikey',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'setcookie',
  'serviceaccountkey',
  'sub',
  'subject',
  'token',
  'updatedat',
  'xinternalauth',
]);

const auth0SubjectPattern = /\bauth0\|[A-Za-z0-9._~:/=-]+\b/u;
const emailLikePattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/u;
const e164LikePattern = /^\+[1-9]\d{7,14}$/u;
const internalAuthAssignmentPattern =
  /\b(?:FA_[A-Z0-9_]*?(?:TOKEN|SECRET|API[_-]?KEY)|X-Internal-Auth)\s*=\s*\S+/iu;
const providerKeyPattern = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/u;
const serviceAccountKeyPathPattern = /\/[^\s]*?(?:keys\/[^\s]*\.json|[^\s/]*key[^\s/]*\.json)\b/u;

function normalizeHeaderName(header: string): string {
  return header.toLowerCase();
}

function normalizeSensitiveFieldName(field: string): string {
  return field.replaceAll('-', '').replaceAll('_', '').toLowerCase();
}

function isSensitiveHeader(header: string): boolean {
  const normalized = normalizeHeaderName(header);

  return exactSensitiveHeaders.has(normalized) || normalized.endsWith('api-key');
}

function isSensitiveField(field: string): boolean {
  const normalized = normalizeSensitiveFieldName(field);

  return (
    normalizedSensitiveFields.has(normalized) ||
    normalized.endsWith('apikey') ||
    normalized.includes('authorization') ||
    normalized.includes('password') ||
    normalized.includes('secret') ||
    normalized.includes('token')
  );
}

function isPlainObject(value: object): value is Record<string, unknown> {
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function isJwtLikeString(value: string): boolean {
  const trimmed = value.trim();
  const token = /^Bearer\s+(.+)$/iu.exec(trimmed)?.[1] ?? trimmed;

  return /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{3,}$/u.test(token);
}

function isSensitiveString(value: string): boolean {
  const trimmed = value.trim();

  return (
    isJwtLikeString(trimmed) ||
    emailLikePattern.test(trimmed) ||
    e164LikePattern.test(trimmed) ||
    auth0SubjectPattern.test(trimmed) ||
    internalAuthAssignmentPattern.test(trimmed) ||
    providerKeyPattern.test(trimmed) ||
    serviceAccountKeyPathPattern.test(trimmed)
  );
}

export function shouldLogRequest(url: string | undefined): boolean {
  if (url === undefined) {
    return true;
  }

  const path = url.split('?')[0] ?? url;
  return path !== '/health';
}

export function sanitizeRequestUrlForLog(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }

  try {
    return new URL(url, 'http://fa.local').pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return isSensitiveString(value) ? REDACTED_HEADER_VALUE : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }

  if (typeof value !== 'object' || value === null || !isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([field, fieldValue]) => [
      field,
      isSensitiveField(field) ? REDACTED_HEADER_VALUE : redactLogValue(fieldValue),
    ])
  );
}

export function redactHeaders(headers: HeaderSource): Record<string, HeaderValue | string> {
  return Object.fromEntries(
    Object.entries(headers).map(([header, value]) => [
      header,
      isSensitiveHeader(header) ? REDACTED_HEADER_VALUE : (redactLogValue(value) as HeaderValue),
    ])
  );
}

export function registerQuietRequestLogging(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    if (shouldLogRequest(request.url)) {
      app.log.info(
        {
          requestId: request.id,
          req: {
            id: request.id,
            method: request.method,
            url: sanitizeRequestUrlForLog(request.url),
            headers: redactHeaders(request.headers as HeaderSource),
            remoteAddress: request.ip,
          },
        },
        'incoming request'
      );
    }

    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    if (shouldLogRequest(request.url)) {
      app.log.info(
        {
          requestId: request.id,
          req: {
            id: request.id,
            method: request.method,
            url: sanitizeRequestUrlForLog(request.url),
          },
          res: { statusCode: reply.statusCode },
          responseTime: reply.elapsedTime,
        },
        'request completed'
      );
    }

    done();
  });
}

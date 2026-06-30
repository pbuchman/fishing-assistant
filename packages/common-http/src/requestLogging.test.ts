import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import {
  redactHeaders,
  redactLogValue,
  registerQuietRequestLogging,
  shouldLogRequest,
} from './requestLogging.js';

function createCaptureDestination(): {
  lines: string[];
  destination: { write: (line: string) => void };
} {
  const lines: string[] = [];

  return {
    lines,
    destination: {
      write(line: string): void {
        lines.push(line);
      },
    },
  };
}

describe('request logging helpers', () => {
  it('skips health check requests', () => {
    expect(shouldLogRequest('/health')).toBe(false);
    expect(shouldLogRequest('/health?from=pm2')).toBe(false);
  });

  it('logs normal paths', () => {
    expect(shouldLogRequest('/status')).toBe(true);
    expect(shouldLogRequest('/api/chat/conversations')).toBe(true);
    expect(shouldLogRequest(undefined)).toBe(true);
  });

  it('redacts sensitive headers and provider API key names', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer secret',
        cookie: 'fa_session=secret',
        'Set-Cookie': ['fa_session=secret'],
        'X-Internal-Auth': 'internal-secret',
        'x-openrouter-api-key': 'openrouter-secret',
        'x-openai-api-key': 'openai-secret',
        'x-gemini-api-key': 'gemini-secret',
        'x-custom-api-key': 'provider-secret',
        'content-type': 'application/json',
      })
    ).toEqual({
      Authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'Set-Cookie': '[REDACTED]',
      'X-Internal-Auth': '[REDACTED]',
      'x-openrouter-api-key': '[REDACTED]',
      'x-openai-api-key': '[REDACTED]',
      'x-gemini-api-key': '[REDACTED]',
      'x-custom-api-key': '[REDACTED]',
      'content-type': 'application/json',
    });
  });

  it('redacts nested Auth0 claims, PII fields, provider keys, and JWT-looking strings', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdXRoMHx1c2VyLTEyMyJ9.signature';
    const privateKeyBlock = [
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      'secret-material',
      ['-----END', 'PRIVATE KEY-----'].join(' '),
    ].join('\n');

    expect(
      redactLogValue({
        email: 'angler@example.com',
        mobileNumber: '+15550101000',
        phone: '+15550101000',
        name: 'River Angler',
        subject: 'auth0|user-123',
        sub: 'auth0|user-123',
        auth0Subject: 'auth0|user-123',
        email_verified: true,
        emailVerified: true,
        authorization: 'Bearer secret',
        providerApiKey: 'provider-secret',
        accessToken: jwt,
        serviceAccountKey: privateKeyBlock,
        nested: {
          id_token: jwt,
          harmless: 'visible',
        },
        list: [jwt, 'visible'],
      })
    ).toEqual({
      email: '[REDACTED]',
      mobileNumber: '[REDACTED]',
      phone: '[REDACTED]',
      name: '[REDACTED]',
      subject: '[REDACTED]',
      sub: '[REDACTED]',
      auth0Subject: '[REDACTED]',
      email_verified: '[REDACTED]',
      emailVerified: '[REDACTED]',
      authorization: '[REDACTED]',
      providerApiKey: '[REDACTED]',
      accessToken: '[REDACTED]',
      serviceAccountKey: '[REDACTED]',
      nested: {
        id_token: '[REDACTED]',
        harmless: 'visible',
      },
      list: ['[REDACTED]', 'visible'],
    });
  });

  it('redacts sensitive string patterns under unknown field names without mutating the input', () => {
    const input = {
      note: 'visible',
      nested: {
        bearer: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdXRoMHx1c2VyLTEifQ.signature',
        contact: 'angler@example.com',
        phoneHint: '+15550101000',
        principal: 'auth0|abc123',
        runtimeKeyPath: '/etc/fa/keys/runtime-sa-key.json',
        internalValue: 'FA_INTERNAL_AUTH_TOKEN=current-secret-token',
        providerValue: ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
      },
      list: ['visible', 'operator@example.com', '+15551234567'],
    };
    const snapshot = structuredClone(input);

    expect(redactLogValue(input)).toEqual({
      note: 'visible',
      nested: {
        bearer: '[REDACTED]',
        contact: '[REDACTED]',
        phoneHint: '[REDACTED]',
        principal: '[REDACTED]',
        runtimeKeyPath: '[REDACTED]',
        internalValue: '[REDACTED]',
        providerValue: '[REDACTED]',
      },
      list: ['visible', '[REDACTED]', '[REDACTED]'],
    });
    expect(input).toEqual(snapshot);
  });

  it('leaves non-object primitives, null, and non-plain objects unchanged', () => {
    const date = new Date('2026-06-16T12:00:00.000Z');

    expect(redactLogValue(null)).toBeNull();
    expect(redactLogValue(42)).toBe(42);
    expect(redactLogValue(false)).toBe(false);
    expect(redactLogValue(date)).toBe(date);
  });

  it('logs incoming request paths without query strings', async () => {
    const capture = createCaptureDestination();
    const app = Fastify({
      disableRequestLogging: true,
      logger: {
        level: 'info',
        stream: capture.destination,
      },
    });
    registerQuietRequestLogging(app);
    app.get('/api/chat/conversations', () => ({ ok: true }));

    await app.inject({
      method: 'GET',
      url: [
        '/api/chat/conversations',
        '?email=angler%40example.com',
        '&mobileNumber=%2B15551234567',
        '&sub=auth0%7Cuser-123',
        '&token=secret-token',
        '&sourceUrl=https%3A%2F%2Fexample.invalid%2Fsecret',
        '&prompt=sensitive%20question',
        '&safe=kept',
      ].join(''),
    });
    await app.close();

    const records = capture.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const incoming = records.find((record) => record['msg'] === 'incoming request');

    expect(typeof incoming?.['requestId']).toBe('string');
    expect(incoming).toMatchObject({
      req: {
        method: 'GET',
        url: '/api/chat/conversations',
      },
    });
    expect(JSON.stringify(incoming)).not.toContain('?');
    expect(JSON.stringify(incoming)).not.toContain('angler');
    expect(JSON.stringify(incoming)).not.toContain('15551234567');
    expect(JSON.stringify(incoming)).not.toContain('auth0');
    expect(JSON.stringify(incoming)).not.toContain('secret-token');
    expect(JSON.stringify(incoming)).not.toContain('sourceUrl');
    expect(JSON.stringify(incoming)).not.toContain('sensitive%20question');
    expect(JSON.stringify(incoming)).not.toContain('safe=kept');
  });
});

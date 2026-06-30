import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';

import { createAppLogger, getServiceLogLevel, redactMetadata } from './logger.js';

function getSerializers(logger: Logger): Record<string, (value: unknown) => unknown> {
  const serializers = (logger as unknown as Record<symbol, unknown>)[
    Symbol.for('pino.serializers')
  ];
  if (serializers === undefined || serializers === null || typeof serializers !== 'object') {
    throw new Error('logger serializers were not installed');
  }

  return serializers as Record<string, (value: unknown) => unknown>;
}

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

describe('observability logger', () => {
  it('resolves service log levels from FA_LOG_LEVEL with safe defaults', () => {
    expect(getServiceLogLevel({})).toBe('info');
    expect(getServiceLogLevel({ FA_LOG_LEVEL: 'warn' })).toBe('warn');
    expect(getServiceLogLevel({ FA_LOG_LEVEL: 'verbose' })).toBe('info');
    expect(getServiceLogLevel({ NODE_ENV: 'test', FA_LOG_LEVEL: 'error' })).toBe('silent');
  });

  it('creates app loggers with required stream bindings', () => {
    const logger = createAppLogger({
      service: 'chat-service',
      environment: 'dev',
      sha: 'abc123',
      level: 'silent',
    });

    expect(logger.bindings()).toMatchObject({
      app: 'fishing-assistant',
      service: 'chat-service',
      env: 'dev',
      sha: 'abc123',
    });

    const withoutSha = createAppLogger({
      service: 'knowledge-service',
      environment: 'prod',
      level: 'silent',
    });

    expect(withoutSha.bindings()).toMatchObject({
      app: 'fishing-assistant',
      service: 'knowledge-service',
      env: 'prod',
    });
    expect(withoutSha.bindings()).not.toHaveProperty('sha');

    const withUndefinedOptionals = createAppLogger({
      service: 'llm-usage-service',
      environment: undefined,
      sha: undefined,
      level: undefined,
    });

    expect(withUndefinedOptionals.bindings()).toMatchObject({
      app: 'fishing-assistant',
      service: 'llm-usage-service',
      env: 'unknown',
    });
  });

  it('redacts sensitive keys in nested metadata', () => {
    expect(
      redactMetadata({
        headers: {
          authorization: 'Bearer secret',
          'x-internal-auth': 'internal-token',
          accept: 'application/json',
        },
        nested: [
          {
            apiKey: 'provider-key',
            token: 'grafana-token',
            safe: 'kept',
          },
        ],
        credentials: {
          client_email: 'runtime@example.iam.gserviceaccount.com',
        },
        private_key: '[private key placeholder]',
        keyFile: '/etc/fa/keys/runtime-sa-key.json',
        FA_GCP_ADMIN_KEY_FILE: '$HOME/.config/gcloud/fa-admin-key.json',
        serviceAccountPath: '/etc/fa/keys/runtime-sa-key.json',
      })
    ).toEqual({
      headers: {
        authorization: '[REDACTED]',
        'x-internal-auth': '[REDACTED]',
        accept: 'application/json',
      },
      nested: [
        {
          apiKey: '[REDACTED]',
          token: '[REDACTED]',
          safe: 'kept',
        },
      ],
      credentials: '[REDACTED]',
      private_key: '[REDACTED]',
      keyFile: '[REDACTED]',
      FA_GCP_ADMIN_KEY_FILE: '[REDACTED]',
      serviceAccountPath: '[REDACTED]',
    });
  });

  it('redacts circular metadata without throwing', () => {
    const metadata: Record<string, unknown> = { safe: 'kept' };
    metadata['self'] = metadata;

    expect(redactMetadata(metadata)).toEqual({
      safe: 'kept',
      self: '[Circular]',
    });

    const shared = { safe: 'reused' };
    expect(redactMetadata({ first: shared, second: shared })).toEqual({
      first: { safe: 'reused' },
      second: { safe: 'reused' },
    });
  });

  it('redacts circular arrays while preserving safe primitive values', () => {
    const metadata: unknown[] = ['safe'];
    metadata.push(metadata);

    expect(redactMetadata(metadata)).toEqual(['safe', '[Circular]']);
    expect(redactMetadata('plain')).toBe('plain');
    expect(redactMetadata(null)).toBeNull();
  });

  it('redacts sensitive string values under otherwise safe keys', () => {
    const jwt = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdXRoMHx1c2VyLTEifQ.signature';

    expect(
      redactMetadata({
        note: 'visible',
        contactHint: 'angler@example.com',
        phoneHint: '+15551234567',
        principalHint: 'auth0|user-123',
        bearerHint: jwt,
        providerHint: ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
        geminiHint: 'AIzaSyD1234567890abcdefghijklmn',
        runtimePathHint: '/etc/fa/keys/runtime-sa-key.json',
        adminKeyPathHint: '$HOME/.config/gcloud/fa-admin-key.json',
        assignmentHint: 'FA_INTERNAL_AUTH_TOKEN=current-secret-token',
        headerHint: 'X-Internal-Auth: previous-secret-token',
        promptLikeHint: 'prompt: sensitive prompt fragment',
        evidenceLikeHint: 'evidence: sensitive retrieval fragment',
        sourceTextLikeHint: 'sourceText: sensitive source fragment',
        nested: {
          safe: 'kept',
          list: ['kept', 'operator@example.com'],
        },
      })
    ).toEqual({
      note: 'visible',
      contactHint: '[REDACTED]',
      phoneHint: '[REDACTED]',
      principalHint: '[REDACTED]',
      bearerHint: '[REDACTED]',
      providerHint: '[REDACTED]',
      geminiHint: '[REDACTED]',
      runtimePathHint: '[REDACTED]',
      adminKeyPathHint: '[REDACTED]',
      assignmentHint: '[REDACTED]',
      headerHint: '[REDACTED]',
      promptLikeHint: '[REDACTED]',
      evidenceLikeHint: '[REDACTED]',
      sourceTextLikeHint: '[REDACTED]',
      nested: {
        safe: 'kept',
        list: ['kept', '[REDACTED]'],
      },
    });
  });

  it('redacts user profile and ownership fields by key', () => {
    expect(
      redactMetadata({
        userId: 'user-123',
        targetUserId: 'user-456',
        actorUserId: 'admin-1',
        currentUserId: 'current-user',
        firstName: 'Ada',
        lastName: 'Admin',
        fullName: 'Ada Admin',
        displayName: 'Ada A.',
        name: 'Ada',
        nickname: 'ada',
        email: 'not-an-email',
        phoneNumber: '5551234567',
        picture: 'https://example.invalid/avatar.png',
        avatarUrl: 'https://example.invalid/avatar.png',
        createdBy: 'creator',
        updatedBy: 'updater',
        approvedBy: 'approver',
        rejectedBy: 'rejecter',
        suspendedBy: 'suspender',
        profile: {
          firstName: 'Nested',
          mobileNumber: '5551234567',
        },
        publicMessage: 'safe operational event',
        requestId: 'req-123',
      })
    ).toEqual({
      userId: '[REDACTED]',
      targetUserId: '[REDACTED]',
      actorUserId: '[REDACTED]',
      currentUserId: '[REDACTED]',
      firstName: '[REDACTED]',
      lastName: '[REDACTED]',
      fullName: '[REDACTED]',
      displayName: '[REDACTED]',
      name: '[REDACTED]',
      nickname: '[REDACTED]',
      email: '[REDACTED]',
      phoneNumber: '[REDACTED]',
      picture: '[REDACTED]',
      avatarUrl: '[REDACTED]',
      createdBy: '[REDACTED]',
      updatedBy: '[REDACTED]',
      approvedBy: '[REDACTED]',
      rejectedBy: '[REDACTED]',
      suspendedBy: '[REDACTED]',
      profile: '[REDACTED]',
      publicMessage: 'safe operational event',
      requestId: 'req-123',
    });
  });

  it('redacts prompt, evidence, citation, and source text fields', () => {
    expect(
      redactMetadata({
        prompt: 'User asked about a sensitive location',
        systemPrompt: 'Use the retrieved context',
        evidence: 'Retrieved sensitive knowledge text',
        citations: [{ title: 'Sample source note', sourceText: 'Sensitive source excerpt' }],
        source_text: 'Original source text',
        publicMessage: 'safe operational event',
      })
    ).toEqual({
      prompt: '[REDACTED]',
      systemPrompt: '[REDACTED]',
      evidence: '[REDACTED]',
      citations: '[REDACTED]',
      source_text: '[REDACTED]',
      publicMessage: 'safe operational event',
    });
  });

  it('installs redacting req and res serializers on the Pino logger', () => {
    const logger = createAppLogger({
      service: 'chat-service',
      level: 'silent',
    });
    const serializers = getSerializers(logger);

    expect(
      serializers['req']?.({
        headers: {
          authorization: 'Bearer secret',
          accept: 'application/json',
        },
        body: {
          token: 'grafana-token',
        },
      })
    ).toEqual({
      headers: {
        authorization: '[REDACTED]',
        accept: 'application/json',
      },
      body: {
        token: '[REDACTED]',
      },
    });

    expect(
      serializers['res']?.({
        statusCode: 500,
        headers: {
          'x-internal-auth': 'internal-token',
        },
      })
    ).toEqual({
      statusCode: 500,
      headers: {
        'x-internal-auth': '[REDACTED]',
      },
    });
  });

  it('redacts sensitive keys in emitted structured log metadata', () => {
    const capture = createCaptureDestination();
    const logger = createAppLogger({
      service: 'chat-service',
      environment: 'dev',
      level: 'info',
      destination: capture.destination,
    });

    const metadata: Record<string, unknown> = {
      token: 'grafana-token',
      nested: {
        apiKey: 'provider-key',
        safe: 'kept',
      },
      private_key: '[private key placeholder]',
      keyFile: '/etc/fa/keys/runtime-sa-key.json',
    };
    metadata['self'] = metadata;

    logger.info(metadata, 'metadata probe');

    expect(capture.lines).toHaveLength(1);
    const record = JSON.parse(capture.lines[0] ?? '{}') as Record<string, unknown>;

    expect(record).toMatchObject({
      level: 'info',
      msg: 'metadata probe',
      token: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]',
        safe: 'kept',
      },
      private_key: '[REDACTED]',
      keyFile: '[REDACTED]',
      self: '[Circular]',
    });
    expect(JSON.stringify(record)).not.toContain('grafana-token');
    expect(JSON.stringify(record)).not.toContain('provider-key');
    expect(JSON.stringify(record)).not.toContain('runtime-sa-key.json');
  });

  it('redacts sensitive values in emitted structured log metadata', () => {
    const capture = createCaptureDestination();
    const logger = createAppLogger({
      service: 'knowledge-service',
      environment: 'dev',
      level: 'info',
      destination: capture.destination,
    });

    logger.info(
      {
        event: 'safe_event',
        detail: 'angler@example.com',
        note: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdXRoMHx1c2VyLTEifQ.signature',
        prompt: 'sensitive prompt fragment',
        sourceText: 'sensitive source text',
      },
      'sensitive value probe'
    );

    expect(capture.lines).toHaveLength(1);
    const record = JSON.parse(capture.lines[0] ?? '{}') as Record<string, unknown>;

    expect(record).toMatchObject({
      event: 'safe_event',
      detail: '[REDACTED]',
      note: '[REDACTED]',
      prompt: '[REDACTED]',
      sourceText: '[REDACTED]',
    });
    expect(JSON.stringify(record)).not.toContain('angler@example.com');
    expect(JSON.stringify(record)).not.toContain('eyJhbGci');
    expect(JSON.stringify(record)).not.toContain('sensitive prompt fragment');
    expect(JSON.stringify(record)).not.toContain('sensitive source text');
  });
});

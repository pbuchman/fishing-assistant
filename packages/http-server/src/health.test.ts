import { describe, expect, it } from 'vitest';

import {
  computeOverallHealth,
  runHealthChecks,
  secretsHealthCheck,
  type HealthCheckResult,
} from './health.js';

describe('health helpers', () => {
  it('returns down from the secrets health check when env values are missing', async () => {
    const check = secretsHealthCheck(['FA_INTERNAL_AUTH_TOKEN', 'FA_GCP_PROJECT_ID'], {
      FA_INTERNAL_AUTH_TOKEN: 'token',
    });

    await expect(check.check()).resolves.toEqual({
      ok: false,
      detail: 'missing: FA_GCP_PROJECT_ID',
    });
  });

  it('returns ok from the secrets health check when env values are present', async () => {
    const check = secretsHealthCheck(['FA_INTERNAL_AUTH_TOKEN'], {
      FA_INTERNAL_AUTH_TOKEN: 'token',
    });

    await expect(check.check()).resolves.toEqual({ ok: true });
  });

  it('computes down when any health check is down', () => {
    const checks: HealthCheckResult[] = [
      { name: 'secrets', status: 'ok', latencyMs: 1, details: null },
      { name: 'firestore', status: 'down', latencyMs: 2, details: { detail: 'offline' } },
    ];

    expect(computeOverallHealth(checks)).toBe('down');
  });

  it('computes degraded when no health check is down and at least one is degraded', () => {
    const checks: HealthCheckResult[] = [
      { name: 'secrets', status: 'ok', latencyMs: 1, details: null },
      { name: 'cache', status: 'degraded', latencyMs: 2, details: { detail: 'slow' } },
    ];

    expect(computeOverallHealth(checks)).toBe('degraded');
  });

  it('records null details for a failed health check without detail text', async () => {
    const [result] = await runHealthChecks([
      {
        name: 'probe',
        check: () => Promise.resolve({ ok: false }),
      },
    ]);

    expect(result).toMatchObject({
      name: 'probe',
      status: 'down',
      details: null,
    });
  });

  it('turns thrown probe errors into down check details', async () => {
    const [result] = await runHealthChecks([
      {
        name: 'probe',
        check: () => {
          throw new Error('probe exploded');
        },
      },
    ]);

    expect(result).toMatchObject({
      name: 'probe',
      status: 'down',
      details: { error: 'probe exploded' },
    });
    expect(result?.latencyMs).toEqual(expect.any(Number));
  });
});

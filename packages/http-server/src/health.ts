import { getErrorMessage } from '@fa/common-core';

import { findMissingEnv } from './env.js';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheck {
  name: string;
  check(): Promise<{ ok: true } | { ok: false; detail?: string }>;
}

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details: Record<string, unknown> | null;
}

export function secretsHealthCheck(
  required: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): HealthCheck {
  return {
    name: 'secrets',
    check() {
      const missing = findMissingEnv(required, env);
      if (missing.length === 0) {
        return Promise.resolve({ ok: true });
      }

      return Promise.resolve({ ok: false, detail: `missing: ${missing.join(', ')}` });
    },
  };
}

async function runHealthCheck(check: HealthCheck): Promise<HealthCheckResult> {
  const startedAt = Date.now();

  try {
    const outcome = await check.check();
    return {
      name: check.name,
      status: outcome.ok ? 'ok' : 'down',
      latencyMs: Date.now() - startedAt,
      details: outcome.ok || outcome.detail === undefined ? null : { detail: outcome.detail },
    };
  } catch (error) {
    return {
      name: check.name,
      status: 'down',
      latencyMs: Date.now() - startedAt,
      details: { error: getErrorMessage(error) },
    };
  }
}

export async function runHealthChecks(
  checks: readonly HealthCheck[]
): Promise<HealthCheckResult[]> {
  return await Promise.all(checks.map((check) => runHealthCheck(check)));
}

export function computeOverallHealth(checks: readonly HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === 'down')) {
    return 'down';
  }

  if (checks.some((check) => check.status === 'degraded')) {
    return 'degraded';
  }

  return 'ok';
}

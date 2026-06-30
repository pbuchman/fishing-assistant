import { describe, expect, it } from 'vitest';

import {
  healthResponseSchema,
  statusResponseSchema,
  systemMetadataSchema,
  type HealthResponse,
  type StatusResponse,
  type SystemMetadata,
} from './system.js';

describe('system HTTP contracts', () => {
  it('requires service, environment, and uptime in system metadata', () => {
    const metadata: SystemMetadata = {
      service: 'chat-service',
      environment: 'test',
      uptime: 1.25,
    };

    expect(metadata).toEqual({
      service: 'chat-service',
      environment: 'test',
      uptime: 1.25,
    });
    expect(systemMetadataSchema).toMatchObject({
      required: ['service', 'environment', 'uptime'],
    });
  });

  it('defines health responses without version metadata', () => {
    const response: HealthResponse = {
      ok: true,
      data: {
        service: 'knowledge-service',
        environment: 'test',
        uptime: 2,
      },
    };

    expect(response.data).not.toHaveProperty('version');
    expect(healthResponseSchema.properties.data).toBe(systemMetadataSchema);
  });

  it('defines status responses with version metadata', () => {
    const response: StatusResponse = {
      ok: true,
      data: {
        service: 'llm-usage-service',
        environment: 'test',
        uptime: 3,
        version: '0.1.0',
      },
    };

    expect(response.data.version).toBe('0.1.0');
    expect(statusResponseSchema.properties.data).toMatchObject({
      required: ['service', 'environment', 'uptime', 'version'],
    });
  });
});

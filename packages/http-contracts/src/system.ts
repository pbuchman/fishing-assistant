import type { ApiSuccessEnvelope } from './envelope.js';

export interface SystemMetadata {
  service: string;
  environment: string;
  uptime: number;
}

export interface StatusMetadata extends SystemMetadata {
  version: string;
}

export type HealthResponse = ApiSuccessEnvelope<SystemMetadata>;
export type StatusResponse = ApiSuccessEnvelope<StatusMetadata>;

export const systemMetadataSchema = {
  type: 'object',
  required: ['service', 'environment', 'uptime'],
  additionalProperties: false,
  properties: {
    service: { type: 'string' },
    environment: { type: 'string' },
    uptime: { type: 'number' },
  },
} as const;

export const statusMetadataSchema = {
  type: 'object',
  required: ['service', 'environment', 'uptime', 'version'],
  additionalProperties: false,
  properties: {
    service: { type: 'string' },
    environment: { type: 'string' },
    uptime: { type: 'number' },
    version: { type: 'string' },
  },
} as const;

export const healthResponseSchema = {
  type: 'object',
  required: ['ok', 'data'],
  additionalProperties: false,
  properties: {
    ok: { const: true },
    data: systemMetadataSchema,
  },
} as const;

export const statusResponseSchema = {
  type: 'object',
  required: ['ok', 'data'],
  additionalProperties: false,
  properties: {
    ok: { const: true },
    data: statusMetadataSchema,
  },
} as const;

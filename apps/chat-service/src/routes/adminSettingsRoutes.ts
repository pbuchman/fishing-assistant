import type { ErrorCode } from '@fa/common-core';
import { strictEmptyObjectSchema } from '@fa/http-contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { ChatModelSettingsUseCaseError } from '../domain/usecases/chatModelSettings.js';
import { serviceName } from '../config.js';
import { getServices } from '../services.js';
import {
  requireApprovedAdminAuth,
  requireApprovedRequestAuthorization,
} from './authPreHandlers.js';

const updateChatModelSettingsBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'modelId', 'expectedRevision'],
  properties: {
    provider: { type: 'string', enum: ['openrouter', 'minimax'] },
    modelId: { type: 'string', minLength: 1 },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
} as const;

interface UpdateChatModelSettingsBody {
  provider: 'openrouter' | 'minimax';
  modelId: string;
  expectedRevision: number;
}

export interface RuntimeDiagnosticsConfig {
  serviceName?: string;
  environment: string;
  releaseSha?: string | null;
  streamTimeoutMs: number;
  edgeProxyReadTimeoutMs?: number | null;
}

function toHttpErrorCode(error: ChatModelSettingsUseCaseError): ErrorCode {
  switch (error.code) {
    case 'INVALID_MODEL':
      return 'INVALID_REQUEST';
    case 'CONFLICT':
    case 'INTERNAL_ERROR':
      return error.code;
    default:
      return 'INTERNAL_ERROR';
  }
}

async function failUseCase(reply: FastifyReply, error: ChatModelSettingsUseCaseError) {
  return await reply.fail(toHttpErrorCode(error), error.message);
}

function edgeTimeoutFromConfig(config: RuntimeDiagnosticsConfig) {
  const proxyReadTimeoutMs = config.edgeProxyReadTimeoutMs ?? null;
  if (proxyReadTimeoutMs === null) {
    return {
      proxyReadTimeoutMs,
      note: 'No configured public edge proxy timeout for this runtime.',
    };
  }

  return {
    proxyReadTimeoutMs,
    note: 'PROD nginx proxy_read_timeout is 330s; app chat stream timeout is 300s.',
  };
}

export function registerAdminSettingsRoutes(
  app: FastifyInstance,
  diagnosticsConfig: RuntimeDiagnosticsConfig = {
    serviceName,
    environment: 'test',
    streamTimeoutMs: 300_000,
    edgeProxyReadTimeoutMs: null,
  }
): void {
  app.get('/admin/settings/chat-model', {
    preValidation: requireApprovedAdminAuth,
    schema: { querystring: strictEmptyObjectSchema },
    handler: async (_request, reply) => {
      const services = getServices();

      return await reply.ok(await services.chatModelSettingsManager.getChatModelSettings());
    },
  });

  app.patch('/admin/settings/chat-model', {
    preValidation: requireApprovedAdminAuth,
    schema: {
      body: updateChatModelSettingsBodySchema,
      querystring: strictEmptyObjectSchema,
    },
    handler: async (request, reply) => {
      const body = request.body as UpdateChatModelSettingsBody;
      const services = getServices();
      const authorization = requireApprovedRequestAuthorization(request);
      const result = await services.chatModelSettingsManager.updateChatModelSettings({
        provider: body.provider,
        modelId: body.modelId,
        expectedRevision: body.expectedRevision,
        updatedByUserId: authorization.userId,
      });
      if (!result.ok) {
        return await failUseCase(reply, result.error);
      }

      return await reply.ok(result.value);
    },
  });

  app.get('/admin/settings/runtime-diagnostics', {
    preValidation: requireApprovedAdminAuth,
    schema: { querystring: strictEmptyObjectSchema },
    handler: async (_request, reply) => {
      const services = getServices();
      const activeModel = await services.chatModelSettingsManager.resolveActiveChatModel();

      return await reply.ok({
        service: diagnosticsConfig.serviceName ?? serviceName,
        environment: diagnosticsConfig.environment,
        releaseSha: diagnosticsConfig.releaseSha ?? null,
        provider: activeModel.provider,
        activeModel,
        streamTimeoutMs: diagnosticsConfig.streamTimeoutMs,
        processing: {
          assistantRuntime: 'single-retrieval-tool',
          outputFormat: 'json_object',
          outputParser: 'strict-json',
        },
        edgeTimeout: edgeTimeoutFromConfig(diagnosticsConfig),
      });
    },
  });
}

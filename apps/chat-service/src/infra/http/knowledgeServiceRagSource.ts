import {
  InternalClientError,
  createKnowledgeServiceClient,
  type FetchLike,
  type KnowledgeServiceClient,
  type KnowledgeRagEvidence,
} from '@fa/internal-clients';
import { err, getErrorMessage, ok, type Result } from '@fa/common-core';

import type {
  RagEvidence,
  RagEvidenceSourceType,
  RagSource,
  RagSourceError,
} from '../../domain/rag/rag.js';
import type { RetrievalTracePerformance } from '../../domain/models/chat.js';

export type { FetchLike } from '@fa/internal-clients';

export type KnowledgeServiceRagSourceParams =
  | {
      client: KnowledgeServiceClient;
    }
  | {
      baseUrl: string;
      internalAuthToken: string;
      fetch?: FetchLike;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function isRagEvidenceSourceType(value: unknown): value is RagEvidenceSourceType {
  return value === 'knowledge_page';
}

function isRagEvidenceMetadata(value: unknown): value is RagEvidence['metadata'] {
  const forbiddenKnowledgeMetadataKeys = ['documentId', 'pageId', 'chunkId'];
  return (
    isRecord(value) &&
    optionalStringArray(value['headingPath']) &&
    optionalStringArray(value['path']) &&
    optionalString(value['sourceLabel']) &&
    forbiddenKnowledgeMetadataKeys.every((key) => value[key] === undefined)
  );
}

function isRagEvidence(value: unknown): value is RagEvidence {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['sourceId'] === 'string' &&
    isRagEvidenceSourceType(value['sourceType']) &&
    typeof value['title'] === 'string' &&
    typeof value['quote'] === 'string' &&
    typeof value['content'] === 'string' &&
    typeof value['score'] === 'number' &&
    Number.isFinite(value['score']) &&
    optionalString(value['url']) &&
    optionalString(value['date']) &&
    isRagEvidenceMetadata(value['metadata'])
  );
}

function parseRagEvidenceItems(
  value: readonly KnowledgeRagEvidence[]
): Result<RagEvidence[], RagSourceError> {
  const items: RagEvidence[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRagEvidence(item)) {
      return err({
        code: 'INVALID_RESPONSE',
        message: `Knowledge Service retrieval item ${String(index)} was malformed`,
      });
    }

    items.push(item);
  }

  return ok(items);
}

function mapClientError(error: unknown): RagSourceError {
  if (error instanceof InternalClientError) {
    return {
      code: error.code === 'INVALID_RESPONSE' ? 'INVALID_RESPONSE' : 'DOWNSTREAM_ERROR',
      message:
        error.statusCode === undefined
          ? error.message
          : `Knowledge Service retrieval failed with status ${String(error.statusCode)}`,
    };
  }

  return { code: 'DOWNSTREAM_ERROR', message: getErrorMessage(error) };
}

function safeKnowledgeDiagnostics(value: Record<string, unknown>): Record<string, unknown> {
  const diagnostics: Record<string, unknown> = {};
  for (const key of [
    'embeddingModel',
    'embeddingProvider',
    'embeddingDimensions',
    'searchedChunkCount',
    'expandedItemCount',
    'vectorCandidateLimit',
    'vectorReturnedCount',
    'vectorReturnedEmbeddingsIncluded',
    'lexicalScannedCount',
    'lexicalLimitHit',
    'activeCurrentChunkCount',
  ]) {
    const entry = value[key];
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      diagnostics[key] = entry;
    }
  }
  return diagnostics;
}

function safeKnowledgePerformance(
  value: Record<string, unknown>
): RetrievalTracePerformance | undefined {
  const performance = value['performance'];
  if (!isRecord(performance)) {
    return undefined;
  }

  const keys = [
    'totalMs',
    'embeddingMs',
    'vectorSearchMs',
    'lexicalFetchMs',
    'lexicalScoringMs',
    'lexicalCandidatesMs',
    'candidateMergeMs',
    'pageLookupMs',
    'rankingMs',
    'expansionMs',
  ] as const;

  const sanitized = {} as RetrievalTracePerformance;
  for (const key of keys) {
    const entry = performance[key];
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) {
      return undefined;
    }
    sanitized[key] = entry;
  }

  return sanitized;
}

export function createKnowledgeServiceRagSource(
  params: KnowledgeServiceRagSourceParams
): RagSource {
  const client =
    'client' in params
      ? params.client
      : createKnowledgeServiceClient({
          baseUrl: params.baseUrl,
          internalAuthToken: params.internalAuthToken,
          ...(params.fetch !== undefined ? { fetch: params.fetch } : {}),
        });

  return {
    id: 'knowledge-service',
    label: 'Baza Wiedzy',
    async retrieve(input) {
      try {
        const response = await client.retrieve(
          {
            authorization: input.authorization,
            query: input.query,
            conversationContext: {
              latestMessages: input.latestMessages.map((message) => ({
                role: message.role,
                content: message.content,
                ...(message.citations !== undefined ? { citations: message.citations } : {}),
              })),
            },
            ...(input.conversationId !== undefined || input.messageId !== undefined
              ? {
                  usageCorrelation: {
                    ...(input.conversationId !== undefined
                      ? { conversationId: input.conversationId }
                      : {}),
                    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
                  },
                }
              : {}),
            options: {
              topK: input.limits.maxEvidenceItems,
            },
          },
          input.signal === undefined ? undefined : { signal: input.signal }
        );

        const parsedItems = parseRagEvidenceItems(response.items);
        if (!parsedItems.ok) {
          return parsedItems;
        }
        const performance = safeKnowledgePerformance(response.diagnostics);

        return ok({
          sourceId: 'knowledge-service',
          items: parsedItems.value,
          coverageProbe: response.coverageProbe,
          diagnostics: safeKnowledgeDiagnostics(response.diagnostics),
          ...(performance === undefined ? {} : { performance }),
        });
      } catch (error) {
        return err(mapClientError(error));
      }
    },
  };
}

export type CreateRagSourcesInput =
  | {
      knowledgeServiceClient: KnowledgeServiceClient;
    }
  | {
      knowledgeServiceUrl: string;
      internalAuthToken: string;
    };

export function createRagSources(input: CreateRagSourcesInput): RagSource[] {
  return [
    createKnowledgeServiceRagSource(
      'knowledgeServiceClient' in input
        ? { client: input.knowledgeServiceClient }
        : {
            baseUrl: input.knowledgeServiceUrl,
            internalAuthToken: input.internalAuthToken,
          }
    ),
  ];
}

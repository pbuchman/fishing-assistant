export type JsonSchema = Readonly<Record<string, unknown>>;

import { ragAuthorizationContextSchema, userLevelValues } from './auth.js';
import {
  answerGapCandidateCountBucketValues,
  answerGapConsentStatusValues,
  answerGapCoverageClassificationValues,
  answerGapSourceValues,
  knowledgeCoverageKindValues,
} from './answerGaps.js';

export const strictEmptyObjectSchema = {
  type: 'object',
  additionalProperties: false,
} as const satisfies JsonSchema;

const knowledgeEffectiveAccessGateValues = ['public', 'approved', 'level', 'excluded'] as const;

const usageServiceValues = ['chat-service', 'knowledge-service'] as const;
const usageOperationValues = ['chat.completion', 'chat.stream', 'embedding'] as const;
const usageTimeBucketValues = ['day', 'hour'] as const;
const usageGroupByValues = [
  'time.bucket',
  'owner.id',
  'request.provider',
  'request.model',
  'source.service',
  'source.component',
  'source.operation',
  'source.promptType',
] as const;
const usageSortFieldValues = [
  'calls',
  'estimatedCostUsd',
  'inputTokens',
  'outputTokens',
  'totalTokens',
] as const;

const usageEventInputSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: {},
    owner: {},
    source: {},
    request: {},
    usage: {},
    cost: {},
    correlation: {},
  },
} as const satisfies JsonSchema;

export const chatConversationParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conversationId'],
  properties: {
    conversationId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const chatStreamRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    message: { type: 'string', minLength: 1, pattern: '\\S' },
  },
} as const satisfies JsonSchema;

export const chatAnswerGapCandidateParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidateId'],
  properties: {
    candidateId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const chatAnswerGapCandidateShareBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['includeContext', 'includeContact'],
  properties: {
    includeContext: { type: 'boolean' },
    includeContact: { type: 'boolean' },
  },
} as const satisfies JsonSchema;

export const chatTestCompletionRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'requester'],
  properties: {
    conversationId: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1, pattern: '\\S' },
    requester: {
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'email', 'role', 'effectiveLevel'],
      properties: {
        userId: { type: 'string', minLength: 1 },
        email: { type: 'string', minLength: 1 },
        firstName: {
          anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
        },
        lastName: {
          anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
        },
        role: { type: 'string', enum: ['user', 'admin'] },
        effectiveLevel: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
} as const satisfies JsonSchema;

export const knowledgeMaintenanceBodySchema = strictEmptyObjectSchema;

export const knowledgeAdminTreeQuerystringSchema = strictEmptyObjectSchema;

export const knowledgeAdminCategoryParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId'],
  properties: {
    categoryId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminSectionParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sectionId'],
  properties: {
    sectionId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminPageParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pageId'],
  properties: {
    pageId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminAccessRefreshJobParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: {
    jobId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;

export const knowledgeSourceQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceRef'],
  properties: {
    sourceRef: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

const knowledgeAdminAccessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['gate', 'requiredLevel'],
  properties: {
    gate: { type: 'string', enum: knowledgeEffectiveAccessGateValues },
    requiredLevel: {
      anyOf: [{ type: 'integer', minimum: 1, maximum: 10 }, { type: 'null' }],
    },
  },
} as const satisfies JsonSchema;

const knowledgeAdminSourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'url'],
  properties: {
    type: { type: 'string', enum: ['external'] },
    url: { type: 'string', minLength: 1 },
    label: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
  },
} as const satisfies JsonSchema;

const knowledgeAdminRelationsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    relatedTo: { type: 'array', items: { type: 'string', minLength: 1 } },
    linksTo: { type: 'array', items: { type: 'string', minLength: 1 } },
    supersedes: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminCreateCategoryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'access'],
  properties: {
    title: { type: 'string', minLength: 1 },
    access: knowledgeAdminAccessSchema,
    sortIndex: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminUpdateCategoryBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1 },
    sortIndex: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminUpdateCategoryAccessBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['access'],
  properties: {
    access: knowledgeAdminAccessSchema,
    expectedAccessRevision: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminCreateSectionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1 },
    sortIndex: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminUpdateSectionBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1 },
    sortIndex: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminCreatePageBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['categoryId', 'title', 'source', 'markdown'],
  properties: {
    categoryId: { type: 'string', minLength: 1 },
    sectionId: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    title: { type: 'string', minLength: 1 },
    source: knowledgeAdminSourceSchema,
    relations: knowledgeAdminRelationsSchema,
    markdown: { type: 'string', minLength: 1 },
    syncNow: { type: 'boolean' },
    sortIndex: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminUpdatePageBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1 },
    sectionId: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    source: knowledgeAdminSourceSchema,
    relations: knowledgeAdminRelationsSchema,
    markdown: { type: 'string', minLength: 1 },
    syncNow: { type: 'boolean' },
    sortIndex: { type: 'integer', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminContentQualityAcknowledgementBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['issueType', 'markdownContentHash', 'issueFingerprints'],
  properties: {
    issueType: { type: 'string', enum: ['adjacent_duplicate_content'] },
    markdownContentHash: { type: 'string', minLength: 1 },
    issueFingerprints: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    reason: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
  },
} as const satisfies JsonSchema;

export const knowledgeSourceResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'sourceId', 'title', 'content', 'updatedAt', 'access'],
  properties: {
    id: { type: 'string', minLength: 1 },
    sourceId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    content: { type: 'string' },
    updatedAt: { type: 'string', minLength: 1 },
    access: {
      type: 'object',
      additionalProperties: false,
      required: ['gate', 'requiredLevel', 'retrievalReady'],
      properties: {
        gate: { type: 'string', enum: knowledgeEffectiveAccessGateValues },
        requiredLevel: {
          anyOf: [{ type: 'integer', minimum: 1, maximum: 10 }, { type: 'null' }],
        },
        retrievalReady: { type: 'boolean' },
      },
    },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminSyncBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['changed', 'all'] },
  },
} as const satisfies JsonSchema;

export const knowledgeRetrieveRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['authorization', 'query', 'conversationContext'],
  properties: {
    authorization: ragAuthorizationContextSchema,
    query: { type: 'string' },
    conversationContext: {
      type: 'object',
      additionalProperties: false,
      required: ['latestMessages'],
      properties: {
        latestMessages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'content'],
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
              citations: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['sourceId', 'usedFor'],
                  properties: {
                    sourceId: { type: 'string' },
                    usedFor: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    usageCorrelation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        conversationId: { type: 'string' },
        messageId: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        topK: { type: 'number' },
        expandParentDocuments: { type: 'boolean' },
      },
    },
  },
} as const satisfies JsonSchema;

const answerGapCoverageProbeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'minRequiredLevel', 'candidateCountBucket', 'probeVersion'],
  properties: {
    classification: { type: 'string', enum: answerGapCoverageClassificationValues },
    minRequiredLevel: {
      anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }],
    },
    candidateCountBucket: { type: 'string', enum: answerGapCandidateCountBucketValues },
    probeVersion: { type: 'string', enum: ['1.0.0'] },
  },
} as const satisfies JsonSchema;

const answerGapRequesterSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'email', 'role', 'effectiveLevel'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    email: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    firstName: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    lastName: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    role: { type: 'string', enum: ['user', 'admin'] },
    effectiveLevel: { type: 'integer', enum: userLevelValues },
  },
} as const satisfies JsonSchema;

const answerGapConsentSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'sharedAt', 'includeContext', 'includeContact', 'candidateId'],
  properties: {
    status: { type: 'string', enum: answerGapConsentStatusValues },
    sharedAt: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    withdrawnAt: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
    includeContext: { type: 'boolean' },
    includeContact: { type: 'boolean' },
    candidateId: {
      anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    },
  },
} as const satisfies JsonSchema;

const answerGapContextMessageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['role', 'content'],
  properties: {
    role: { type: 'string', enum: ['user', 'assistant'] },
    content: { type: 'string' },
  },
} as const satisfies JsonSchema;

const answerGapConversationSnapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['conversationId', 'userMessageId', 'assistantMessageId', 'contextWindow'],
  properties: {
    conversationId: { type: 'string', minLength: 1 },
    userMessageId: { type: 'string', minLength: 1 },
    assistantMessageId: { type: 'string', minLength: 1 },
    contextWindow: {
      type: 'array',
      items: answerGapContextMessageSchema,
    },
  },
} as const satisfies JsonSchema;

export const knowledgeInternalCreateAnswerGapBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'source',
    'question',
    'missingInformation',
    'requester',
    'conversation',
    'coverageProbe',
    'coverageKind',
    'consent',
  ],
  properties: {
    source: { type: 'string', enum: answerGapSourceValues },
    question: { type: 'string', minLength: 1 },
    missingInformation: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    requester: answerGapRequesterSnapshotSchema,
    conversation: answerGapConversationSnapshotSchema,
    coverageProbe: answerGapCoverageProbeSchema,
    coverageKind: { type: 'string', enum: knowledgeCoverageKindValues },
    consent: answerGapConsentSnapshotSchema,
  },
} as const satisfies JsonSchema;

export const knowledgeAdminAnswerGapListQuerystringSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['needs_answer', 'all'] },
    limit: {
      anyOf: [
        { type: 'integer', minimum: 1, maximum: 100 },
        { type: 'string', pattern: '^(?:[1-9][0-9]?|100)$' },
      ],
    },
    cursor: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminAnswerGapParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['gapId'],
  properties: {
    gapId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const knowledgeAdminAnswerGapDoneBodySchema = strictEmptyObjectSchema;

export const knowledgeInternalAnswerGapConsentWithdrawalBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidateId'],
  properties: {
    candidateId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const llmUsageEventsRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: usageEventInputSchema,
    },
  },
} as const satisfies JsonSchema;

const llmUsageAdminTimeRangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', minLength: 1 },
    to: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

const nonEmptyStringArraySchema = {
  type: 'array',
  minItems: 1,
  items: { type: 'string', minLength: 1 },
} as const satisfies JsonSchema;

export const llmUsageAdminDimensionsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', minLength: 1 },
    to: { type: 'string', minLength: 1 },
    timeBucket: { type: 'string', enum: usageTimeBucketValues },
  },
} as const satisfies JsonSchema;

const llmUsageAdminFiltersSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    userIds: nonEmptyStringArraySchema,
    providers: nonEmptyStringArraySchema,
    models: nonEmptyStringArraySchema,
    services: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: usageServiceValues },
    },
    components: nonEmptyStringArraySchema,
    operations: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: usageOperationValues },
    },
    promptTypes: nonEmptyStringArraySchema,
    promptVersions: nonEmptyStringArraySchema,
  },
} as const satisfies JsonSchema;

export const llmUsageAdminAggregateQueryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['timeRange'],
  properties: {
    timeRange: llmUsageAdminTimeRangeSchema,
    timeBucket: { type: 'string', enum: usageTimeBucketValues },
    filters: llmUsageAdminFiltersSchema,
    groupBy: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', enum: usageGroupByValues },
    },
    sortBy: {
      type: 'object',
      additionalProperties: false,
      required: ['field', 'direction'],
      properties: {
        field: { type: 'string', enum: usageSortFieldValues },
        direction: { type: 'string', enum: ['asc', 'desc'] },
      },
    },
    limit: { type: 'integer', minimum: 1 },
  },
} as const satisfies JsonSchema;

export const llmUsageAdminEventsQueryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['timeRange'],
  properties: {
    timeRange: llmUsageAdminTimeRangeSchema,
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userIds: nonEmptyStringArraySchema,
        providers: nonEmptyStringArraySchema,
        models: nonEmptyStringArraySchema,
        services: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: usageServiceValues },
        },
        components: nonEmptyStringArraySchema,
        operations: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: usageOperationValues },
        },
        promptTypes: nonEmptyStringArraySchema,
      },
    },
    limit: { type: 'integer', minimum: 1 },
    cursor: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const llmUsageAdminEventParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['eventId'],
  properties: {
    eventId: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const pricingParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'model'],
  properties: {
    provider: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

export const pricingUpdateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['inputUsdPer1M', 'outputUsdPer1M'],
  properties: {
    inputUsdPer1M: { type: 'number', minimum: 0 },
    outputUsdPer1M: { type: 'number', minimum: 0 },
    embeddingUsdPer1M: { type: 'number', minimum: 0 },
    updatedAt: { type: 'string', minLength: 1 },
  },
} as const satisfies JsonSchema;

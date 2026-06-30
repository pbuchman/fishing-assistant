import { describe, expect, it } from 'vitest';

import {
  answerGapCoverageClassificationValues,
  chatAnswerGapCandidateParamsSchema,
  chatAnswerGapCandidateShareBodySchema,
  chatConversationParamsSchema,
  chatStreamRequestBodySchema,
  knowledgeAdminCreateCategoryBodySchema,
  knowledgeAdminCreatePageBodySchema,
  knowledgeAdminCreateSectionBodySchema,
  knowledgeAdminContentQualityAcknowledgementBodySchema,
  knowledgeAdminUpdatePageBodySchema,
  knowledgeAdminAnswerGapDoneBodySchema,
  knowledgeAdminAnswerGapListQuerystringSchema,
  knowledgeAdminAnswerGapParamsSchema,
  knowledgeAdminPageParamsSchema,
  knowledgeInternalAnswerGapConsentWithdrawalBodySchema,
  knowledgeInternalCreateAnswerGapBodySchema,
  knowledgeMaintenanceBodySchema,
  knowledgeSourceQuerystringSchema,
  knowledgeSourceResponseSchema,
  knowledgeRetrieveRequestBodySchema,
  llmUsageAdminAggregateQueryBodySchema,
  llmUsageAdminDimensionsQuerySchema,
  llmUsageAdminEventParamsSchema,
  llmUsageAdminEventsQueryBodySchema,
  llmUsageEventsRequestBodySchema,
  pricingUpdateBodySchema,
  strictEmptyObjectSchema,
} from './index.js';

describe('route JSON schemas', () => {
  it('exports reusable chat stream route schemas', () => {
    expect(strictEmptyObjectSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(chatConversationParamsSchema).toMatchObject({
      required: ['conversationId'],
      properties: { conversationId: { type: 'string', minLength: 1 } },
    });
    expect(chatStreamRequestBodySchema).toMatchObject({
      required: ['message'],
      properties: { message: { type: 'string', minLength: 1 } },
    });
    expect(chatAnswerGapCandidateParamsSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['candidateId'],
      properties: {
        candidateId: { type: 'string', minLength: 1 },
      },
    });
    expect(chatAnswerGapCandidateShareBodySchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['includeContext', 'includeContact'],
      properties: {
        includeContext: { type: 'boolean' },
        includeContact: { type: 'boolean' },
      },
    });
  });

  it('exports reusable knowledge route schemas', () => {
    expect(knowledgeAdminCreateCategoryBodySchema).toMatchObject({
      required: ['title', 'access'],
      properties: {
        access: {
          required: ['gate', 'requiredLevel'],
        },
      },
    });
    expect(knowledgeAdminCreateSectionBodySchema).toMatchObject({
      required: ['title'],
      properties: {
        title: { type: 'string', minLength: 1 },
      },
    });
    expect(knowledgeAdminCreatePageBodySchema).toMatchObject({
      required: ['categoryId', 'title', 'source', 'markdown'],
      properties: {
        categoryId: { type: 'string', minLength: 1 },
        markdown: { type: 'string', minLength: 1 },
      },
    });
    expect(knowledgeAdminCreatePageBodySchema.properties).not.toHaveProperty('workspaceId');
    expect(knowledgeAdminPageParamsSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['pageId'],
      properties: {
        pageId: { type: 'string', minLength: 1 },
      },
    });
    expect(knowledgeMaintenanceBodySchema).toEqual(strictEmptyObjectSchema);
    expect(knowledgeRetrieveRequestBodySchema).toMatchObject({
      required: ['authorization', 'query', 'conversationContext'],
      properties: {
        authorization: {
          required: ['userId', 'role', 'status', 'effectiveLevel'],
        },
        query: { type: 'string' },
        conversationContext: {
          required: ['latestMessages'],
          properties: {
            latestMessages: {
              items: {
                required: ['role', 'content'],
              },
            },
          },
        },
      },
    });
    expect(knowledgeRetrieveRequestBodySchema.properties).not.toHaveProperty('workspaceId');
    expect(knowledgeSourceQuerystringSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['sourceRef'],
      properties: {
        sourceRef: { type: 'string', minLength: 1 },
      },
    });
    expect(knowledgeSourceResponseSchema).toMatchObject({
      required: ['id', 'sourceId', 'title', 'content', 'updatedAt', 'access'],
      properties: {
        access: {
          required: ['gate', 'requiredLevel', 'retrievalReady'],
        },
      },
    });
  });

  it('requires a source URL for admin knowledge page source metadata', () => {
    const sourceSchema = knowledgeAdminCreatePageBodySchema.properties.source;

    expect(knowledgeAdminCreatePageBodySchema.required).toEqual(
      expect.arrayContaining(['categoryId', 'title', 'source', 'markdown'])
    );
    expect(sourceSchema).toMatchObject({
      required: ['type', 'url'],
      properties: {
        type: { type: 'string', enum: ['external'] },
        url: { type: 'string', minLength: 1 },
      },
    });
    expect(knowledgeAdminUpdatePageBodySchema.properties.source).toBe(sourceSchema);
  });

  it('exports duplicate content acknowledgement route schema', () => {
    expect(knowledgeAdminContentQualityAcknowledgementBodySchema).toMatchObject({
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
      },
    });
  });

  it('exports strict answer gap route schemas', () => {
    expect(knowledgeAdminAnswerGapListQuerystringSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(knowledgeAdminAnswerGapParamsSchema).toMatchObject({
      required: ['gapId'],
    });
    expect(knowledgeAdminAnswerGapDoneBodySchema).toBe(strictEmptyObjectSchema);
    expect(knowledgeInternalAnswerGapConsentWithdrawalBodySchema).toMatchObject({
      required: ['candidateId'],
      properties: { candidateId: { type: 'string', minLength: 1 } },
    });
    expect(knowledgeInternalCreateAnswerGapBodySchema).toMatchObject({
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
      additionalProperties: false,
      properties: {
        consent: {
          additionalProperties: false,
          required: ['status', 'sharedAt', 'includeContext', 'includeContact', 'candidateId'],
        },
        requester: {
          additionalProperties: false,
          properties: {
            effectiveLevel: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
            email: {
              anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
            },
            firstName: {
              anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
            },
            lastName: {
              anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
            },
          },
        },
      },
    });
    expect(answerGapCoverageClassificationValues).toEqual([
      'no_candidate_seen',
      'accessible_candidate_seen',
      'higher_level_candidate_seen',
      'restricted_or_invalid_candidate_seen',
    ]);
  });

  it('exports reusable usage and pricing route schemas', () => {
    expect(llmUsageEventsRequestBodySchema).toMatchObject({
      required: ['events'],
      properties: {
        events: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
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
          },
        },
      },
    });
    expect(pricingUpdateBodySchema).toMatchObject({
      required: ['inputUsdPer1M', 'outputUsdPer1M'],
      properties: {
        inputUsdPer1M: { type: 'number', minimum: 0 },
        outputUsdPer1M: { type: 'number', minimum: 0 },
      },
    });
  });

  it('exports reusable admin usage reporting route schemas', () => {
    expect(llmUsageAdminAggregateQueryBodySchema).toMatchObject({
      required: ['timeRange'],
      properties: {
        timeRange: {
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
          },
        },
        timeBucket: { type: 'string', enum: ['day', 'hour'] },
        groupBy: {
          type: 'array',
          items: {
            enum: [
              'time.bucket',
              'owner.id',
              'request.provider',
              'request.model',
              'source.service',
              'source.component',
              'source.operation',
              'source.promptType',
            ],
          },
        },
        limit: { type: 'integer', minimum: 1 },
      },
    });
    expect(llmUsageAdminAggregateQueryBodySchema.properties.filters).toMatchObject({
      properties: {
        userIds: { type: 'array', minItems: 1 },
        providers: { type: 'array', minItems: 1 },
        components: { type: 'array', minItems: 1 },
        services: {
          type: 'array',
          minItems: 1,
          items: { enum: ['chat-service', 'knowledge-service'] },
        },
        operations: {
          type: 'array',
          minItems: 1,
          items: { enum: ['chat.completion', 'chat.stream', 'embedding'] },
        },
      },
    });

    expect(llmUsageAdminEventsQueryBodySchema).toMatchObject({
      required: ['timeRange'],
      properties: {
        timeRange: {
          required: ['from', 'to'],
        },
        filters: {
          properties: {
            components: { type: 'array', minItems: 1 },
          },
        },
        limit: { type: 'integer', minimum: 1 },
        cursor: { type: 'string', minLength: 1 },
      },
    });
    expect(llmUsageAdminDimensionsQuerySchema).toMatchObject({
      properties: {
        from: { type: 'string', minLength: 1 },
        to: { type: 'string', minLength: 1 },
        timeBucket: { type: 'string', enum: ['day', 'hour'] },
      },
    });
    expect(llmUsageAdminEventParamsSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['eventId'],
      properties: {
        eventId: { type: 'string', minLength: 1 },
      },
    });
  });
});

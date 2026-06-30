import { expect, test } from 'vitest';

import {
  apiErrorEnvelopeSchema,
  answerGapCandidateStatusValues,
  answerGapConsentStatusValues,
  chatStreamProgressStatusValues,
  chatStreamEventTypes,
  healthResponseSchema,
  INTERNAL_AUTH_HEADER,
  INTERNAL_AUTH_HEADER_CANONICAL,
  knowledgeCoverageKindValues,
  userStatusValues,
} from '@fa/http-contracts';

test('exports HTTP contract utilities', () => {
  expect(apiErrorEnvelopeSchema.properties.ok).toEqual({ const: false });
  expect(healthResponseSchema.properties.data.required).toEqual([
    'service',
    'environment',
    'uptime',
  ]);
  expect(INTERNAL_AUTH_HEADER).toBe('x-internal-auth');
  expect(INTERNAL_AUTH_HEADER_CANONICAL).toBe('X-Internal-Auth');
  expect(userStatusValues).toEqual([
    'profile_required',
    'pending',
    'approved',
    'rejected',
    'suspended',
  ]);
});

test('exports explicit chat stream event names without retired stream aliases', () => {
  expect(chatStreamEventTypes).toEqual([
    'message.created',
    'retrieval.started',
    'retrieval.completed',
    'answer.started',
    'answer.delta',
    'answer.progress',
    'answer.citation',
    'answer.missing_info',
    'answer.gap_candidate',
    'answer.final',
    'done',
    'error',
  ]);
  expect(chatStreamEventTypes).not.toContain('token');
  expect(chatStreamEventTypes).not.toContain('citations');
  expect(chatStreamEventTypes).not.toContain('missing_info');
  expect(chatStreamEventTypes).not.toContain('message.completed');
});

test('exports chat stream progress statuses used by clients', () => {
  expect(chatStreamProgressStatusValues).toEqual(['long_running', 'preparing_sources']);
});

test('exports answer gap consent contract values', () => {
  expect(knowledgeCoverageKindValues).toEqual([
    'global_no_candidate_seen',
    'restricted_by_level',
    'restricted_or_invalid_candidate_seen',
    'unsupported_by_accessible_evidence',
    'coverage_unknown',
  ]);
  expect(answerGapCandidateStatusValues).toEqual([
    'pending_user_consent',
    'shared',
    'declined',
    'expired',
    'withdrawn',
  ]);
  expect(answerGapConsentStatusValues).toEqual(['system_imported', 'user_shared', 'user_withdrew']);
});

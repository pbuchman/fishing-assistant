import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConversationQueries, parseConversationArgs } from './conversation-logs.mjs';

test('parseConversationArgs requires conversation id, env, and bounded window', () => {
  assert.throws(() => parseConversationArgs(['node', 'conversation-logs.mjs']), /conversationId/);
  assert.throws(
    () =>
      parseConversationArgs([
        'node',
        'conversation-logs.mjs',
        'fc86b542-eed6-41c8-9c0a-d795c22d2521',
        '--env',
        'prod',
        '--window',
        '3h',
      ]),
    /time window must not exceed 2h/
  );
  assert.throws(
    () =>
      parseConversationArgs([
        'node',
        'conversation-logs.mjs',
        'Mam lowisko z okoniem',
        '--env',
        'prod',
      ]),
    /conversationId must be a UUID/
  );
  assert.throws(
    () =>
      parseConversationArgs([
        'node',
        'conversation-logs.mjs',
        'fc86b542-eed6-41c8-9c0a-d795c22d2521',
        '--env',
        'prod',
        '--message-id',
        'raw prompt text',
      ]),
    /message-id must be a UUID/
  );
  assert.throws(
    () =>
      parseConversationArgs([
        'node',
        'conversation-logs.mjs',
        'fc86b542-eed6-41c8-9c0a-d795c22d2521',
        '--env',
        'prod',
        '--model',
        'model with prompt text',
      ]),
    /model must match/
  );
});

test('buildConversationQueries searches FA services with safe identifiers', () => {
  const queries = buildConversationQueries({
    conversationId: 'fc86b542-eed6-41c8-9c0a-d795c22d2521',
    env: 'prod',
    messageId: '3434aecc-c125-422d-b9b6-1800d4c7f830',
    model: 'google/gemma-4-31b-it',
    around: '2026-06-21T07:23:08Z',
    windowMs: 900000,
    limit: 50,
  });

  assert.deepEqual(
    queries.map((query) => query.service),
    [
      'chat-service',
      'chat-service focused',
      'knowledge-service',
      'knowledge-service focused',
      'llm-usage-service',
      'llm-usage-service focused',
    ]
  );
  for (const { service, query } of queries) {
    assert.match(query, /\{app="fishing-assistant", env="prod", service=~"/);
    assert.match(query, /fc86b542-eed6-41c8-9c0a-d795c22d2521/);
    assert.match(query, /\\"service\\":\\"(?:chat-service|knowledge-service|llm-usage-service)\\"/);
    if (service.endsWith(' focused')) {
      assert.match(query, /3434aecc-c125-422d-b9b6-1800d4c7f830/);
      assert.match(query, /google\/gemma-4-31b-it/);
    } else {
      assert.doesNotMatch(query, /3434aecc-c125-422d-b9b6-1800d4c7f830/);
      assert.doesNotMatch(query, /google\/gemma-4-31b-it/);
    }
    assert.doesNotMatch(query, /Mam lowisko|raw prompt/);
  }
});

test('buildConversationQueries omits focused queries when no extra identifiers are provided', () => {
  const queries = buildConversationQueries({
    conversationId: 'fc86b542-eed6-41c8-9c0a-d795c22d2521',
    env: 'prod',
    windowMs: 900000,
    limit: 50,
  });

  assert.deepEqual(
    queries.map((query) => query.service),
    ['chat-service', 'knowledge-service', 'llm-usage-service']
  );
});

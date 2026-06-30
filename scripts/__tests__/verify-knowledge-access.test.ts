import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateKnowledgeAccessRepository } from '../verify-knowledge-access.mjs';

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function withKnowledgeAccessFixture<T>(files: Record<string, string>, run: (root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-verify-knowledge-access-'));

  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      writeFile(root, relativePath, contents);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const validAccessRefreshSource = `
export function isKnowledgePageChunkRetrievalEligible({ page, chunk }) {
  if (page === null || page.status !== 'active' || page.accessSyncStatus !== 'current') return false;
  if (chunk.status !== 'active') return false;
  if (chunk.access === undefined || chunk.access.gate === 'manual') return false;
  if (chunk.accessSyncStatus !== 'current') return false;
  if (chunk.accessRevision !== page.access.effective.accessRevision) return false;
  if (chunk.source.url !== null && validateKnowledgeSourceUrl(chunk.source, 'chunk source').ok !== true) return false;
  return true;
}
export const accessRefreshLogEvents = [
  'knowledge_access_refresh_job_claimed',
  'knowledge_access_refresh_job_succeeded',
  'knowledge_access_refresh_job_failed',
  'knowledge_access_chunk_marked_stale',
  'knowledge_access_mismatch_detected',
  'knowledge_source_url_rejected',
  'knowledge_rag_candidate_excluded',
];
export function produceAccessRefreshEvents(logger) {
  logger.info({ event: accessRefreshLogEvents.jobClaimed });
  logger.info({ event: accessRefreshLogEvents.jobSucceeded });
  logger.warn({ event: accessRefreshLogEvents.jobFailed });
  logger.warn({ event: accessRefreshLogEvents.mismatchDetected });
  logger.warn({ event: accessRefreshLogEvents.sourceUrlRejected });
  logger.warn({ event: accessRefreshLogEvents.ragCandidateExcluded });
}
`;

const validRoutesSource = `
app.get('/admin/access-refresh/status', { preValidation: requireApprovedAdminAuth }, handler);
app.post('/admin/access-refresh/jobs/:jobId/retry', { preValidation: [defaultMissingBodyToEmptyObject, requireApprovedAdminAuth] }, handler);
logger.warn({ event: accessRefreshLogEvents.chunkMarkedStale });
createSuccessEnvelope({ service: 'knowledge-service', knowledgeAccess: 'healthy' });
`;

describe('verify knowledge access', () => {
  it('passes when access-refresh guards, routes, script, and collections are present', () => {
    withKnowledgeAccessFixture(
      {
        'package.json': JSON.stringify({
          scripts: { 'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs' },
        }),
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': validAccessRefreshSource,
        'apps/knowledge-service/src/routes/knowledgeRoutes.ts': validRoutesSource,
        'packages/http-contracts/src/routeSchemas.ts':
          "export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false, properties: { jobId: { type: 'string' } } };\nexport const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;",
        'firestore-collections.json': JSON.stringify({
          collections: {
            fa_knowledge_access_refresh_jobs: { owner: 'knowledge-service' },
            fa_knowledge_access_audits: { owner: 'knowledge-service' },
          },
        }),
      },
      (root) => {
        expect(validateKnowledgeAccessRepository(root)).toEqual([]);
      }
    );
  });

  it('fails closed when active chunk eligibility does not reject stale, manual, mismatched, or forbidden URL chunks', () => {
    withKnowledgeAccessFixture(
      {
        'package.json': JSON.stringify({
          scripts: { 'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs' },
        }),
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts':
          'export function isKnowledgePageChunkRetrievalEligible() { return true; }',
        'apps/knowledge-service/src/routes/knowledgeRoutes.ts': validRoutesSource,
        'packages/http-contracts/src/routeSchemas.ts':
          'export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false };\nexport const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;',
        'firestore-collections.json': JSON.stringify({
          collections: {
            fa_knowledge_access_refresh_jobs: { owner: 'knowledge-service' },
            fa_knowledge_access_audits: { owner: 'knowledge-service' },
          },
        }),
      },
      (root) => {
        expect(validateKnowledgeAccessRepository(root)).toEqual(
          expect.arrayContaining([
            expect.stringContaining('must require active chunks to have access metadata'),
            expect.stringContaining('must reject manual chunk access'),
            expect.stringContaining('must reject stale, failed, or invalid chunk access status'),
            expect.stringContaining('must reject page/chunk access revision mismatches'),
            expect.stringContaining('must reject forbidden source URLs'),
          ])
        );
      }
    );
  });

  it('inspects the active chunk eligibility function body instead of accepting comment-only guard strings', () => {
    withKnowledgeAccessFixture(
      {
        'package.json': JSON.stringify({
          scripts: { 'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs' },
        }),
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': `
          export function isKnowledgePageChunkRetrievalEligible({ page, chunk }) {
            return true;
          }
          // chunk.access === undefined
          // chunk.access.gate === 'manual'
          // chunk.accessSyncStatus !== 'current'
          // chunk.accessRevision !== page.access.effective.accessRevision
          // validateKnowledgeSourceUrl(chunk.source, 'chunk source'); chunk.source.url
          // page.accessSyncStatus !== 'current'
        `,
        'apps/knowledge-service/src/routes/knowledgeRoutes.ts': validRoutesSource,
        'packages/http-contracts/src/routeSchemas.ts':
          'export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false };\nexport const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;',
        'firestore-collections.json': JSON.stringify({
          collections: {
            fa_knowledge_access_refresh_jobs: { owner: 'knowledge-service' },
            fa_knowledge_access_audits: { owner: 'knowledge-service' },
          },
        }),
      },
      (root) => {
        expect(validateKnowledgeAccessRepository(root)).toEqual(
          expect.arrayContaining([
            expect.stringContaining('must require active chunks to have access metadata'),
            expect.stringContaining('must reject manual chunk access'),
            expect.stringContaining('must reject stale, failed, or invalid chunk access status'),
            expect.stringContaining('must reject page/chunk access revision mismatches'),
            expect.stringContaining('must reject forbidden source URLs'),
          ])
        );
      }
    );
  });

  it('fails when admin status is not admin-only or public status exposes detailed access data', () => {
    withKnowledgeAccessFixture(
      {
        'package.json': JSON.stringify({
          scripts: { 'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs' },
        }),
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': validAccessRefreshSource,
        'apps/knowledge-service/src/routes/knowledgeRoutes.ts':
          "app.get('/admin/access-refresh/status', handler); createSuccessEnvelope({ pendingJobs: 1, jobId: 'job-1' });",
        'packages/http-contracts/src/routeSchemas.ts':
          'export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false };\nexport const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;',
        'firestore-collections.json': JSON.stringify({
          collections: {
            fa_knowledge_access_refresh_jobs: { owner: 'knowledge-service' },
            fa_knowledge_access_audits: { owner: 'knowledge-service' },
          },
        }),
      },
      (root) => {
        expect(validateKnowledgeAccessRepository(root)).toEqual(
          expect.arrayContaining([
            expect.stringContaining('admin access-refresh status route must require admin auth'),
            expect.stringContaining(
              'public knowledge access status must not expose detailed counts or IDs'
            ),
          ])
        );
      }
    );
  });

  it('detects public status access detail leaks even when knowledgeAccess is not the first field', () => {
    withKnowledgeAccessFixture(
      {
        'package.json': JSON.stringify({
          scripts: { 'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs' },
        }),
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': validAccessRefreshSource,
        'apps/knowledge-service/src/server.ts':
          "export function statusMetadata() { return { pendingJobs: 1, knowledgeAccess: 'healthy' }; }",
        'apps/knowledge-service/src/routes/knowledgeRoutes.ts': validRoutesSource,
        'packages/http-contracts/src/routeSchemas.ts':
          'export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false };\nexport const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;',
        'firestore-collections.json': JSON.stringify({
          collections: {
            fa_knowledge_access_refresh_jobs: { owner: 'knowledge-service' },
            fa_knowledge_access_audits: { owner: 'knowledge-service' },
          },
        }),
      },
      (root) => {
        expect(validateKnowledgeAccessRepository(root)).toContain(
          'apps/knowledge-service/src/server.ts public knowledge access status must not expose detailed counts or IDs'
        );
      }
    );
  });

  it('requires canonical knowledge access events to have producer references outside declarations', () => {
    withKnowledgeAccessFixture(
      {
        'package.json': JSON.stringify({
          scripts: { 'verify:knowledge-access': 'node scripts/verify-knowledge-access.mjs' },
        }),
        'apps/knowledge-service/src/domain/usecases/accessRefresh.ts': validAccessRefreshSource
          .replace(/export function produceAccessRefreshEvents[\s\S]*?}\n/, '')
          .replace('logger.warn({ event: accessRefreshLogEvents.ragCandidateExcluded });', ''),
        'apps/knowledge-service/src/routes/knowledgeRoutes.ts': validRoutesSource.replace(
          'logger.warn({ event: accessRefreshLogEvents.chunkMarkedStale });',
          ''
        ),
        'packages/http-contracts/src/routeSchemas.ts':
          'export const knowledgeAdminAccessRefreshJobParamsSchema = { additionalProperties: false };\nexport const knowledgeAdminAccessRefreshRetryBodySchema = strictEmptyObjectSchema;',
        'firestore-collections.json': JSON.stringify({
          collections: {
            fa_knowledge_access_refresh_jobs: { owner: 'knowledge-service' },
            fa_knowledge_access_audits: { owner: 'knowledge-service' },
          },
        }),
      },
      (root) => {
        expect(validateKnowledgeAccessRepository(root)).toEqual(
          expect.arrayContaining([
            expect.stringContaining('must produce knowledge_access_chunk_marked_stale'),
            expect.stringContaining('must produce knowledge_rag_candidate_excluded'),
          ])
        );
      }
    );
  });
});

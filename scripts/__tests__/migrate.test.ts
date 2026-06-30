import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertNoMigrationChecksumDrift,
  detectMigrationChecksumDrift,
  discoverMigrations,
  firebaseDeployArgs,
  formatMigrationStatus,
  parseArgs,
  writeFirestoreIndexes,
} from '../migrate.mjs'; // @allow-missing-js -- script module is .mjs

const repoRoot = path.resolve(import.meta.dirname, '../..');

describe('migration runner', () => {
  const migration = {
    id: '001',
    name: 'llm-usage-indexes',
    file: '001_llm-usage-indexes.mjs',
    filePath: '/tmp/001_llm-usage-indexes.mjs',
    checksum: 'expected-checksum',
    metadata: {
      id: '001',
      name: 'llm-usage-indexes',
      description: 'Indexes.',
      createdAt: '2026-06-13',
    },
    indexes: [],
    up: () => Promise.resolve(),
  };

  it('discovers Phase 3 migrations in --status without requiring Firestore', () => {
    const output = execFileSync(process.execPath, ['scripts/migrate.mjs', '--status'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, FA_GCP_PROJECT_ID: '' },
    });

    expect(output).toContain('001 | llm-usage-indexes');
    expect(output).toContain('002 | seed-llm-pricing');
    expect(output).toContain('009 | runtime-data-baseline');
    expect(output).toContain('pending');
  });

  it('accepts --project together with --status without requiring Firestore', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/migrate.mjs', '--status', '--project', 'example-fa-project'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, FA_GCP_PROJECT_ID: '' },
      }
    );

    expect(output).toContain('001 | llm-usage-indexes');
    expect(output).toContain('002 | seed-llm-pricing');
  });

  it('ignores a pnpm argument separator before migration options', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/migrate.mjs', '--status', '--', '--project', 'example-fa-project'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, FA_GCP_PROJECT_ID: '' },
      }
    );

    expect(output).toContain('001 | llm-usage-indexes');
    expect(output).toContain('002 | seed-llm-pricing');
  });

  it('discovers unique migration ids', async () => {
    const migrations = await discoverMigrations(repoRoot);
    const ids = migrations.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses Firebase CLI arguments for live Firestore index deployment', () => {
    expect(firebaseDeployArgs('example-fa-project')).toEqual([
      'deploy',
      '--only',
      'firestore:indexes',
      '--project=example-fa-project',
      '--non-interactive',
    ]);
  });

  it('parses live status separately from offline status', () => {
    expect(parseArgs(['--status', '--live', '--project', 'fishing-assistant'])).toEqual({
      status: true,
      liveStatus: true,
      project: 'fishing-assistant',
    });
  });

  it('formats applied migration records from the live ledger', () => {
    expect(formatMigrationStatus([migration], new Map([['001', { status: 'applied' }]]))).toContain(
      '001 | llm-usage-indexes | applied'
    );
  });

  it('does not report checksum drift for applied retired records without checksums', () => {
    const applied = new Map([['001', { status: 'applied' }]]);

    expect(detectMigrationChecksumDrift([migration], applied)).toEqual([]);
    expect(() => {
      assertNoMigrationChecksumDrift([migration], applied);
    }).not.toThrow();
  });

  it('detects checksum drift for applied migration ledger records', () => {
    expect(
      detectMigrationChecksumDrift(
        [migration],
        new Map([['001', { status: 'applied', checksum: 'applied-checksum' }]])
      )
    ).toEqual([
      {
        id: '001',
        name: 'llm-usage-indexes',
        expectedChecksum: 'expected-checksum',
        appliedChecksum: 'applied-checksum',
      },
    ]);
  });

  it('labels checksum drift in live migration status output', () => {
    expect(
      formatMigrationStatus(
        [migration],
        new Map([['001', { status: 'applied', checksum: 'applied-checksum' }]])
      )
    ).toContain(
      '001 | llm-usage-indexes | checksum drift (expected expected-checksum, applied applied-checksum)'
    );
  });

  it('fails clearly before migration success when checksum drift exists', () => {
    expect(() => {
      assertNoMigrationChecksumDrift(
        [migration],
        new Map([['001', { status: 'applied', checksum: 'applied-checksum' }]])
      );
    }).toThrow(
      'Migration checksum drift detected for 001 (llm-usage-indexes): expected expected-checksum, applied applied-checksum'
    );
  });

  it('normalizes vector indexes for Firebase CLI artifacts', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'fa-migrations-'));
    try {
      writeFirestoreIndexes(
        [
          {
            indexes: [
              {
                collectionGroup: 'fishing_knowledge_chunks',
                queryScope: 'COLLECTION',
                fields: [
                  { fieldPath: 'workspaceId', order: 'ASCENDING' },
                  {
                    fieldPath: 'embedding',
                    order: 'ASCENDING',
                    vectorConfig: { dimension: 2048, flatIndexEnabled: true },
                  },
                ],
              },
            ],
          },
        ],
        tempRoot
      );

      expect(
        JSON.parse(readFileSync(path.join(tempRoot, 'firestore.indexes.json'), 'utf8'))
      ).toEqual({
        indexes: [
          {
            collectionGroup: 'fishing_knowledge_chunks',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: 'workspaceId', order: 'ASCENDING' },
              {
                fieldPath: 'embedding',
                vectorConfig: { dimension: 2048, flat: {} },
              },
            ],
          },
        ],
        fieldOverrides: [],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('lets later migrations remove obsolete indexes from generated artifacts', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'fa-migrations-'));
    const obsoleteConversationIndex = {
      collectionGroup: 'fishing_conversations',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'workspaceId', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
      ],
    };
    const obsoleteMessageIndex = {
      collectionGroup: 'fishing_conversation_messages',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'workspaceId', order: 'ASCENDING' },
        { fieldPath: 'conversationId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'ASCENDING' },
      ],
    };
    const replacementConversationIndex = {
      collectionGroup: 'fishing_conversations',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'lastMessageAt', order: 'DESCENDING' },
      ],
    };
    const replacementMessageIndex = {
      collectionGroup: 'fishing_conversation_messages',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'conversationId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'ASCENDING' },
      ],
    };

    try {
      writeFirestoreIndexes(
        [
          { indexes: [obsoleteConversationIndex, obsoleteMessageIndex] },
          {
            indexes: [replacementConversationIndex, replacementMessageIndex],
            removedIndexes: [obsoleteConversationIndex, obsoleteMessageIndex],
          },
        ],
        tempRoot
      );

      const artifact = JSON.parse(
        readFileSync(path.join(tempRoot, 'firestore.indexes.json'), 'utf8')
      ) as { indexes: unknown[] };
      expect(artifact.indexes).toEqual(
        expect.arrayContaining([replacementConversationIndex, replacementMessageIndex])
      );
      expect(artifact.indexes).not.toEqual(
        expect.arrayContaining([obsoleteConversationIndex, obsoleteMessageIndex])
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

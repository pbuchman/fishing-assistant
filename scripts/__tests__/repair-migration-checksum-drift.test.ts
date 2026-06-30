import { describe, expect, it } from 'vitest';

import {
  KNOWN_MIGRATION_CHECKSUM_REPAIRS,
  repairMigrationChecksumDrift,
} from '../repair-migration-checksum-drift-20260629.mjs'; // @allow-missing-js -- script module is .mjs

class FakeDocumentSnapshot {
  constructor(
    readonly exists: boolean,
    private readonly value: Record<string, unknown> | undefined
  ) {}

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}

class FakeFirestore {
  readonly writes = new Map<string, Record<string, unknown>>();
  private readonly documents = new Map<string, Record<string, unknown>>();

  constructor(initialDocuments: Record<string, Record<string, unknown>>) {
    for (const [path, value] of Object.entries(initialDocuments)) {
      this.documents.set(path, value);
    }
  }

  collection(collectionName: string): {
    doc: (documentId: string) => {
      get: () => Promise<FakeDocumentSnapshot>;
      set: (value: Record<string, unknown>) => Promise<void>;
    };
  } {
    return {
      doc: (documentId: string) => {
        const path = `${collectionName}/${documentId}`;

        return {
          get: () =>
            Promise.resolve(
              new FakeDocumentSnapshot(this.documents.has(path), this.documents.get(path))
            ),
          set: (value: Record<string, unknown>) => {
            this.documents.set(path, value);
            this.writes.set(path, value);

            return Promise.resolve();
          },
        };
      },
    };
  }
}

const migrations = [
  {
    id: '016',
    name: 'update-chat-model-catalog-pricing',
    checksum: 'cd86ae512f5fdc22',
  },
  {
    id: '018',
    name: 'set-gemma-chat-model-catalog',
    checksum: '6936d9c06fde2ad3',
  },
];

function ledgerRecord(
  id: '016' | '018',
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const repair = KNOWN_MIGRATION_CHECKSUM_REPAIRS.find((item) => item.id === id);
  if (repair === undefined) {
    throw new Error(`Missing test repair fixture for ${id}`);
  }

  return {
    id,
    ...repair.expectedLedgerMetadata,
    checksum: repair.appliedChecksum,
    status: 'applied',
    appliedAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('migration checksum drift repair workflow', () => {
  it('repairs only the known checksum drifts and records audit fields', async () => {
    const firestore = new FakeFirestore({
      '_migrations/016': ledgerRecord('016'),
      '_migrations/018': ledgerRecord('018'),
    });

    const result = await repairMigrationChecksumDrift({
      firestore,
      migrations,
      apply: true,
      now: '2026-06-29T02:00:00.000Z',
    });

    expect(result).toEqual([
      {
        id: '016',
        previousChecksum: '9c12778b2a27e12e',
        repairedChecksum: 'cd86ae512f5fdc22',
        applied: true,
      },
      {
        id: '018',
        previousChecksum: 'e6ac9e760615c858',
        repairedChecksum: '6936d9c06fde2ad3',
        applied: true,
      },
    ]);
    const repaired016 = firestore.writes.get('_migrations/016');
    const repaired018 = firestore.writes.get('_migrations/018');

    expect(repaired016).toMatchObject({
      checksum: 'cd86ae512f5fdc22',
      repairPreviousChecksum: '9c12778b2a27e12e',
      repairedAt: '2026-06-29T02:00:00.000Z',
    });
    expect(repaired016?.['repairReason']).toContain('applied ledger checksum drift');
    expect(repaired018).toMatchObject({
      checksum: '6936d9c06fde2ad3',
      repairPreviousChecksum: 'e6ac9e760615c858',
      repairedAt: '2026-06-29T02:00:00.000Z',
    });
    expect(repaired018?.['repairReason']).toContain('applied ledger checksum drift');
  });

  it('does not write in dry-run mode', async () => {
    const firestore = new FakeFirestore({
      '_migrations/016': ledgerRecord('016'),
      '_migrations/018': ledgerRecord('018'),
    });

    const result = await repairMigrationChecksumDrift({
      firestore,
      migrations,
      apply: false,
      now: '2026-06-29T02:00:00.000Z',
    });

    expect(result.every((item) => !item.applied)).toBe(true);
    expect(firestore.writes.size).toBe(0);
  });

  it('refuses to repair unexpected live ledger state', async () => {
    const firestore = new FakeFirestore({
      '_migrations/016': ledgerRecord('016', { checksum: 'some-other-checksum' }),
      '_migrations/018': ledgerRecord('018'),
    });

    await expect(
      repairMigrationChecksumDrift({
        firestore,
        migrations,
        apply: true,
        now: '2026-06-29T02:00:00.000Z',
      })
    ).rejects.toThrow(
      'Refusing to repair 016: expected applied checksum 9c12778b2a27e12e, found some-other-checksum'
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  FRESHWATER_TAXONOMY_TITLE_TARGET,
  FRESHWATER_TAXONOMY_TITLE_SOURCE,
  metadata,
  up,
} from '../014_update-freshwater-taxonomy.mjs'; // @allow-missing-js -- migration modules are .mjs

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    readonly ref: { update: (value: Record<string, unknown>) => Promise<void> },
    private readonly value: Record<string, unknown>
  ) {}

  data(): Record<string, unknown> {
    return this.value;
  }
}

class FakeFirestore {
  readonly updates = new Map<string, Record<string, unknown>>();
  private readonly documents = new Map<string, Record<string, unknown>>();

  constructor(initialDocuments: Record<string, Record<string, unknown>>) {
    for (const [path, value] of Object.entries(initialDocuments)) {
      this.documents.set(path, { ...value });
    }
  }

  collection(collectionName: string): {
    get: () => Promise<{ docs: FakeDocumentSnapshot[] }>;
  } {
    return {
      get: () =>
        Promise.resolve({
          docs: [...this.documents.entries()]
            .filter(([path]) => path.startsWith(`${collectionName}/`))
            .map(([path, value]) => {
              const id = path.slice(collectionName.length + 1);
              return new FakeDocumentSnapshot(
                id,
                {
                  update: (patch) => {
                    this.documents.set(path, { ...this.documents.get(path), ...patch });
                    this.updates.set(path, { ...patch });
                    return Promise.resolve();
                  },
                },
                value
              );
            }),
        }),
    };
  }

  getDocument(path: string): Record<string, unknown> | undefined {
    return this.documents.get(path);
  }
}

describe('migration 014 - update Knowledge freshwater taxonomy', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '014',
      name: 'update-freshwater-taxonomy',
      description: 'Normalize a freshwater taxonomy title and dependent paths',
      createdAt: '2026-06-20',
    });
  });

  it('normalizes the freshwater taxonomy title across nodes, pages, and chunks', async () => {
    const firestore = new FakeFirestore({
      'fa_knowledge_nodes/category': {
        status: 'active',
        title: FRESHWATER_TAXONOMY_TITLE_SOURCE,
        slug: 'deprecated-freshwater-taxonomy-label',
        pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_SOURCE],
      },
      'fa_knowledge_nodes/page-node': {
        status: 'active',
        title: 'Karp',
        pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_SOURCE, 'karp', 'Karp'],
      },
      'fa_knowledge_pages/page': {
        status: 'active',
        title: 'Karp',
        pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_SOURCE, 'karp', 'Karp'],
        hierarchy: { category: FRESHWATER_TAXONOMY_TITLE_SOURCE, section: 'karp' },
      },
      'fa_knowledge_chunks/chunk': {
        status: 'active',
        title: 'Karp',
        path: [FRESHWATER_TAXONOMY_TITLE_SOURCE, 'karp', 'Karp'],
        headingPath: ['Karp'],
        searchableText: `${FRESHWATER_TAXONOMY_TITLE_SOURCE} karp Karp`,
      },
      'fa_knowledge_nodes/deleted': {
        status: 'deleted',
        title: FRESHWATER_TAXONOMY_TITLE_SOURCE,
        pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_SOURCE],
      },
    });

    await up({ firestore });

    expect(firestore.getDocument('fa_knowledge_nodes/category')).toMatchObject({
      title: FRESHWATER_TAXONOMY_TITLE_TARGET,
      slug: 'freshwater-taxonomy-label',
      pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_TARGET],
    });
    expect(firestore.getDocument('fa_knowledge_nodes/page-node')).toMatchObject({
      pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_TARGET, 'karp', 'Karp'],
    });
    expect(firestore.getDocument('fa_knowledge_pages/page')).toMatchObject({
      pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_TARGET, 'karp', 'Karp'],
      hierarchy: { category: FRESHWATER_TAXONOMY_TITLE_TARGET, section: 'karp' },
    });
    expect(firestore.getDocument('fa_knowledge_chunks/chunk')).toMatchObject({
      path: [FRESHWATER_TAXONOMY_TITLE_TARGET, 'karp', 'Karp'],
      searchableText: `${FRESHWATER_TAXONOMY_TITLE_TARGET} karp Karp`,
    });
    expect(firestore.getDocument('fa_knowledge_nodes/deleted')).toMatchObject({
      title: FRESHWATER_TAXONOMY_TITLE_SOURCE,
    });
  });
});

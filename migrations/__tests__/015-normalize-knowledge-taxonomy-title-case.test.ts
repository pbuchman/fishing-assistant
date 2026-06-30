import { describe, expect, it } from 'vitest';

import { FRESHWATER_TAXONOMY_TITLE_TARGET } from '../014_update-freshwater-taxonomy.mjs'; // @allow-missing-js -- migration modules are .mjs
import {
  metadata,
  normalizeTaxonomyTitle,
  TAXONOMY_TITLE_CASE_MIGRATION_USER_ID,
  up,
} from '../015_normalize-knowledge-taxonomy-title-case.mjs'; // @allow-missing-js -- migration modules are .mjs

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

describe('migration 015 - normalize Knowledge taxonomy title case', () => {
  it('exports metadata', () => {
    expect(metadata).toEqual({
      id: '015',
      name: 'normalize-knowledge-taxonomy-title-case',
      description: 'Normalize active Knowledge taxonomy category and section title capitalization',
      createdAt: '2026-06-20',
    });
  });

  it('normalizes taxonomy title casing while preserving brand acronyms', () => {
    expect(normalizeTaxonomyTitle('sekcja 2')).toBe('Sekcja 2');
    expect(normalizeTaxonomyTitle('all caps section')).toBe('All caps section');
    expect(normalizeTaxonomyTitle('LIN')).toBe('Lin');
    expect(normalizeTaxonomyTitle('TEST-ACRONYM')).toBe('TEST-ACRONYM');
    expect(normalizeTaxonomyTitle('Sample Section')).toBe('Sample Section');
  });

  it('cascades active category and section title case changes through paths and page hierarchy', async () => {
    const firestore = new FakeFirestore({
      'fa_knowledge_nodes/category-section-2': {
        status: 'active',
        type: 'category',
        title: 'section two',
        slug: 'section-two',
        pathTitles: ['Knowledge Base', 'section two'],
      },
      'fa_knowledge_nodes/category-liquid': {
        status: 'active',
        type: 'category',
        title: 'SAMPLE CATEGORY',
        slug: 'liquid-additives',
        pathTitles: ['Knowledge Base', 'SAMPLE CATEGORY'],
      },
      'fa_knowledge_nodes/category-freshwater': {
        status: 'active',
        type: 'category',
        title: FRESHWATER_TAXONOMY_TITLE_TARGET,
        slug: 'specyfikacja-gatunk-w-ryb-s-odkowodnych',
        pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_TARGET],
      },
      'fa_knowledge_nodes/section-liquid': {
        status: 'active',
        type: 'section',
        title: 'sample section',
        slug: 'liquid-foods',
        pathTitles: ['Knowledge Base', 'SAMPLE CATEGORY', 'sample section'],
      },
      'fa_knowledge_nodes/section-salmonids': {
        status: 'active',
        type: 'section',
        title: 'salmonid family',
        slug: 'salmonid-family',
        pathTitles: ['Knowledge Base', 'section two', 'salmonid family'],
      },
      'fa_knowledge_nodes/page-node': {
        status: 'active',
        type: 'page',
        title: 'Atlantic salmon (Salmo salar)',
        pathTitles: [
          'Knowledge Base',
          'section two',
          'salmonid family',
          'Atlantic salmon (Salmo salar)',
        ],
      },
      'fa_knowledge_nodes/brand-section': {
        status: 'active',
        type: 'section',
        title: 'TEST-ACRONYM',
        slug: 'x-feed',
        pathTitles: ['Knowledge Base', 'Sample Category', 'TEST-ACRONYM'],
      },
      'fa_knowledge_nodes/deleted': {
        status: 'deleted',
        type: 'category',
        title: 'section two',
        pathTitles: ['Knowledge Base', 'section two'],
      },
      'fa_knowledge_pages/page': {
        status: 'active',
        title: 'Sample page',
        pathTitles: ['Knowledge Base', 'SAMPLE CATEGORY', 'sample section', 'Sample page'],
        hierarchy: { category: 'SAMPLE CATEGORY', section: 'sample section' },
      },
      'fa_knowledge_chunks/chunk': {
        status: 'active',
        title: 'Sample page',
        path: ['SAMPLE CATEGORY', 'sample section', 'Sample page'],
        headingPath: ['Sample page'],
        searchableText: 'SAMPLE CATEGORY sample section Sample page',
      },
    });

    // Note: the TEST-ACRONYM fixture mirrors migrations/015_*.mjs PRESERVED_UPPERCASE_TITLES.
    // Other fixture titles intentionally use neutral / generic phrasing where possible so the
    // migration normalization rules are exercised without re-exposing Knowledge Base brand terms.

    await up({ firestore });

    expect(firestore.getDocument('fa_knowledge_nodes/category-section-2')).toMatchObject({
      title: 'Section two',
      slug: 'section-two',
      pathTitles: ['Knowledge Base', 'Section two'],
      updatedByUserId: TAXONOMY_TITLE_CASE_MIGRATION_USER_ID,
    });
    expect(firestore.getDocument('fa_knowledge_nodes/category-liquid')).toMatchObject({
      title: 'Sample category',
      slug: 'sample-category',
      pathTitles: ['Knowledge Base', 'Sample category'],
    });
    expect(firestore.getDocument('fa_knowledge_nodes/category-freshwater')).toMatchObject({
      title: FRESHWATER_TAXONOMY_TITLE_TARGET,
      pathTitles: ['Knowledge Base', FRESHWATER_TAXONOMY_TITLE_TARGET],
    });
    expect(firestore.getDocument('fa_knowledge_nodes/section-liquid')).toMatchObject({
      title: 'Sample section',
      pathTitles: ['Knowledge Base', 'Sample category', 'Sample section'],
    });
    expect(firestore.getDocument('fa_knowledge_nodes/page-node')).toMatchObject({
      title: 'Atlantic salmon (Salmo salar)',
      pathTitles: [
        'Knowledge Base',
        'Section two',
        'Salmonid family',
        'Atlantic salmon (Salmo salar)',
      ],
    });
    expect(firestore.getDocument('fa_knowledge_nodes/brand-section')).toMatchObject({
      title: 'TEST-ACRONYM',
    });
    expect(firestore.getDocument('fa_knowledge_nodes/deleted')).toMatchObject({
      title: 'section two',
    });
    expect(firestore.getDocument('fa_knowledge_pages/page')).toMatchObject({
      pathTitles: ['Knowledge Base', 'Sample category', 'Sample section', 'Sample page'],
      hierarchy: { category: 'Sample category', section: 'Sample section' },
    });
    expect(firestore.getDocument('fa_knowledge_chunks/chunk')).toMatchObject({
      path: ['Sample category', 'Sample section', 'Sample page'],
      searchableText: 'Sample category Sample section Sample page',
    });
  });
});

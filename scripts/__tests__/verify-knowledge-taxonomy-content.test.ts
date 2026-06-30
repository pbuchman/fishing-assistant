import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifyScriptPath = resolve(import.meta.dirname, '../verify-knowledge-taxonomy-content.mjs');
const packageJsonPath = resolve(import.meta.dirname, '../../package.json');

interface KnowledgeTaxonomyContentVerifierModule {
  validateKnowledgeTaxonomyContent(input: { firestore: FakeFirestore }): Promise<string[]>;
}

class FakeDocSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown>
  ) {}

  data(): Record<string, unknown> {
    return structuredClone(this.value);
  }
}

class FakeQuerySnapshot {
  constructor(readonly docs: FakeDocSnapshot[]) {}
}

class FakeCollectionRef {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly name: string
  ) {}

  get(): Promise<FakeQuerySnapshot> {
    return Promise.resolve(
      new FakeQuerySnapshot(
        this.firestore
          .readCollection(this.name)
          .map(({ id, value }) => new FakeDocSnapshot(id, value))
      )
    );
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  seed(collectionName: string, id: string, value: Record<string, unknown>): void {
    const collection =
      this.collections.get(collectionName) ?? new Map<string, Record<string, unknown>>();
    collection.set(id, structuredClone(value));
    this.collections.set(collectionName, collection);
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this, name);
  }

  readCollection(collectionName: string): { id: string; value: Record<string, unknown> }[] {
    const collection = this.collections.get(collectionName);
    if (collection === undefined) {
      return [];
    }

    return [...collection.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => ({ id, value: structuredClone(value) }));
  }
}

async function loadVerifierModule(): Promise<KnowledgeTaxonomyContentVerifierModule | null> {
  expect(existsSync(verifyScriptPath)).toBe(true);
  if (!existsSync(verifyScriptPath)) {
    return null;
  }

  const module: unknown = await import(pathToFileURL(verifyScriptPath).href);
  return module as KnowledgeTaxonomyContentVerifierModule;
}

describe('verify knowledge taxonomy content', () => {
  it('is exposed as an explicit package verification script', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['verify:knowledge-taxonomy-content']).toBe(
      'node scripts/verify-knowledge-taxonomy-content.mjs'
    );
  });

  it('passes when active Knowledge taxonomy content contains only the corrected freshwater wording', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('fa_knowledge_nodes', 'category', {
      status: 'active',
      title: 'Freshwater species specification',
      pathTitles: ['Knowledge Base', 'Freshwater species specification'],
    });
    firestore.seed('fa_knowledge_pages', 'page', {
      status: 'active',
      title: 'Carp',
      pathTitles: ['Knowledge Base', 'Freshwater species specification', 'Carp'],
      hierarchy: { category: 'Freshwater species specification' },
    });
    firestore.seed('fa_knowledge_chunks', 'chunk', {
      status: 'active',
      title: 'Carp',
      path: ['Freshwater species specification', 'Carp'],
      searchableText: 'Freshwater species specification Carp',
    });
    firestore.seed('fa_knowledge_nodes', 'deleted-category', {
      status: 'deleted',
      title: 'deprecated freshwater species text',
      pathTitles: ['Knowledge Base', 'deprecated freshwater species text'],
    });

    await expect(verifier.validateKnowledgeTaxonomyContent({ firestore })).resolves.toEqual([]);
  });

  it('reports deprecated taxonomy terms in active node, page, and chunk taxonomy fields', async () => {
    const verifier = await loadVerifierModule();
    if (verifier === null) {
      return;
    }

    const firestore = new FakeFirestore();
    firestore.seed('fa_knowledge_nodes', 'category-deprecated', {
      status: 'active',
      title: 'deprecated freshwater taxonomy label',
      pathTitles: ['Knowledge Base', 'deprecated freshwater taxonomy label'],
    });
    firestore.seed('fa_knowledge_pages', 'page-deprecated', {
      status: 'active',
      title: 'Tench',
      pathTitles: ['Knowledge Base', 'deprecated freshwater taxonomy label', 'Tench'],
      hierarchy: { category: 'deprecated freshwater taxonomy label' },
    });
    firestore.seed('fa_knowledge_chunks', 'chunk-deprecated', {
      status: 'active',
      title: 'Tench',
      path: ['deprecated freshwater taxonomy label', 'Tench'],
      headingPath: ['Tench'],
      searchableText: 'deprecated freshwater taxonomy label Tench',
    });

    await expect(verifier.validateKnowledgeTaxonomyContent({ firestore })).resolves.toEqual([
      'fa_knowledge_nodes has 1 active document containing forbidden taxonomy text "deprecated freshwater taxonomy label" (samples: category-deprecated fields: title, pathTitles)',
      'fa_knowledge_pages has 1 active document containing forbidden taxonomy text "deprecated freshwater taxonomy label" (samples: page-deprecated fields: pathTitles, hierarchy)',
      'fa_knowledge_chunks has 1 active document containing forbidden taxonomy text "deprecated freshwater taxonomy label" (samples: chunk-deprecated fields: path, searchableText)',
    ]);
  });
});

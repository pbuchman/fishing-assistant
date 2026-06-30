import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConversationMessage, RetrievalEvidenceSummary } from '../services/chatApi.js';
import { CitationList, MissingInformation } from './RagAnswerPanels.js';

afterEach(() => {
  cleanup();
});

function message(quote = 'Publicly safe quote.'): ConversationMessage {
  return {
    id: 'a1',
    userId: 'user-1',
    conversationId: 'c1',
    role: 'assistant',
    content: 'Answer. [S1]',
    createdAt: '2026-06-21T10:00:00.000Z',
    citations: [{ sourceId: 'knowledge-service\u0000knowledge-page:abc', usedFor: 'answer' }],
    missingInformation: [],
    streamStatus: 'completed',
    retrieval: {
      startedAt: '2026-06-21T10:00:00.000Z',
      completedAt: '2026-06-21T10:00:01.000Z',
      query: 'coupon image',
      sources: [],
      evidence: [
        {
          id: 'knowledge-page:abc',
          sourceId: 'knowledge-service',
          sourceType: 'knowledge_page',
          title: 'Evidence Page Title',
          quote,
          score: 0.9,
          publicUrl: 'https://example.com/fishing/float-basics',
          metadata: { headingPath: ['Knowledge heading'], path: ['Knowledge heading'] },
        },
      ],
    },
  };
}

function baseEvidence(): RetrievalEvidenceSummary {
  return {
    id: 'knowledge-page:abc',
    sourceId: 'knowledge-service',
    sourceType: 'knowledge_page',
    title: 'Evidence Page Title',
    quote: 'Publicly safe quote.',
    score: 0.9,
    metadata: { headingPath: ['Knowledge heading'], path: ['Knowledge heading'] },
    publicUrl: 'https://example.com/fishing/float-basics',
  };
}

function messageWithEvidence(
  overrides: Omit<Partial<RetrievalEvidenceSummary>, 'publicUrl'> & {
    publicUrl?: string | null;
  } = {},
  citationOverrides: Partial<ConversationMessage['citations'][number]> = {}
): ConversationMessage {
  const baseMessage = message();
  const { publicUrl, ...restOverrides } = overrides;
  const evidence = {
    ...baseEvidence(),
    ...restOverrides,
  };
  const withOptionalUrl =
    publicUrl === null
      ? (({ publicUrl: _ignored, ...rest }) => rest)(evidence)
      : publicUrl === undefined
        ? evidence
        : { ...evidence, publicUrl };
  const retrieval =
    baseMessage.retrieval ??
    (() => {
      throw new Error('Expected message retrieval to be available.');
    })();

  return {
    ...baseMessage,
    citations: [
      {
        sourceId: 'knowledge-service\u0000knowledge-page:abc',
        usedFor: 'answer',
        ...citationOverrides,
      },
    ],
    retrieval: {
      ...retrieval,
      evidence: [withOptionalUrl],
    },
  };
}

const sourceLabels = {
  showAdditionalSourcesLabel: 'Show {count} more sources',
  hideAdditionalSourcesLabel: 'Hide {count} additional sources',
};

describe('CitationList', () => {
  it('shows a human evidence title as one compact public source row', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({}, { usedFor: 'rig length' })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    expect(screen.getByText('Evidence Page Title')).toBeInTheDocument();
    expect(screen.queryByText('Knowledge base source')).not.toBeInTheDocument();
    expect(screen.queryByText('Source 1')).not.toBeInTheDocument();
    expect(screen.queryByText('rig length')).not.toBeInTheDocument();
    expect(screen.queryByText('Open source')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      'https://example.com/fishing/float-basics'
    );
    expect(document.body.textContent).not.toContain('blocked.example.invalid');
  });

  it('keeps source rows compact in the light chat theme', () => {
    const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');
    const citationLinkBlocks = Array.from(styles.matchAll(/\.citation-row-link\s*{([^}]*)}/g));
    const finalCitationLinkBlock = citationLinkBlocks.at(-1)?.[1] ?? '';

    expect(citationLinkBlocks.length).toBeGreaterThanOrEqual(2);
    expect(finalCitationLinkBlock).toMatch(/background:\s*var\(--fa-surface-muted\)/);
    expect(finalCitationLinkBlock).toMatch(/color:\s*var\(--fa-text\)/);
  });

  it('uses a heading title when the citation title is missing', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({ publicUrl: null, title: '' }, { usedFor: 'answer' })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByText('Knowledge heading')).toBeInTheDocument();
    expect(screen.queryByText('Knowledge base source')).not.toBeInTheDocument();
    expect(screen.queryByText('Source 1')).not.toBeInTheDocument();
    expect(screen.queryByText('answer')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Knowledge heading' })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aabc'
    );
  });

  it('uses evidence headings instead of generic source-number titles', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({
          publicUrl: null,
          title: 'Source 2',
          metadata: { headingPath: ['Method feeder', 'Przynęty'] },
        })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByText('Method feeder / Przynęty')).toBeInTheDocument();
    expect(screen.queryByText('Source 2')).not.toBeInTheDocument();
  });

  it('uses the knowledge-base heading when a public source title is generic', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({
          publicUrl: 'https://example.com/source/2672f02f?md=2f22a93c',
          title: 'Source 1',
          metadata: { headingPath: ['Knowledge Page Title'] },
        })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByText('Knowledge Page Title')).toBeInTheDocument();
    expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('Knowledge base source')).not.toBeInTheDocument();
    expect(screen.queryByText('Source 1')).not.toBeInTheDocument();
  });

  it('omits citations that do not have a source title', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({
          publicUrl: null,
          title: 'Source 1',
          metadata: {},
        })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.queryByRole('heading', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByText('Source 1')).not.toBeInTheDocument();
    expect(screen.queryByText('answer')).not.toBeInTheDocument();
  });

  it('links internal user knowledge sources to the read-only chat source route', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({ publicUrl: null }, { usedFor: 'answer' })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aabc'
    );
  });

  it('links internal admin knowledge sources to the admin page route', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({ publicUrl: null }, { usedFor: 'answer' })}
        showAllLabel="Show all"
        sourceMode="admin"
        {...sourceLabels}
      />
    );

    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      '#/admin/knowledge/abc'
    );
  });

  it('does not render evidence quote snippets in source rows', () => {
    render(
      <CitationList
        message={message(
          'Useful detail from https://blocked.example.invalid/source/source, sample-hidden.png and [safe label](https://another-blocked.example.invalid/page).'
        )}
        heading="Sources"
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByText('Evidence Page Title')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Useful detail from');
    expect(document.body.textContent).not.toContain('safe label');
    expect(document.body.textContent).not.toContain('[image hidden]');
    expect(document.body.textContent).not.toContain('blocked.example.invalid');
    expect(document.body.textContent).not.toContain('another-blocked.example.invalid');
    expect(document.body.textContent).not.toContain('sample-hidden.png');
    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      'https://example.com/fishing/float-basics'
    );
  });

  it('falls back to the internal source route when a public source URL is unsafe', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({ publicUrl: 'javascript:alert(1)' })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aabc'
    );
    expect(document.body.textContent).not.toContain('javascript:alert(1)');
  });

  it('does not render http source URLs as links', () => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({ publicUrl: 'http://example.com/fishing/float-basics' })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aabc'
    );
    expect(screen.queryByText('http://example.com/fishing/float-basics')).not.toBeInTheDocument();
  });

  it.each([
    'https://localhost/fishing/float-basics',
    'https://127.0.0.1/fishing/float-basics',
    'https://example.com/app',
    'https://example.com/api/internal/share-report',
    'https://example.com/admin',
    'https://user:pass@example.com/fishing/float-basics#section',
  ])('blocks unsafe https citation URLs from rendering as links: %s', (publicUrl) => {
    render(
      <CitationList
        heading="Sources"
        message={messageWithEvidence({ publicUrl })}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getByRole('link', { name: /Evidence Page Title/ })).toHaveAttribute(
      'href',
      '#/chat/source/knowledge-page%3Aabc'
    );
    expect(document.body.textContent).not.toContain(publicUrl);
  });

  it('shows one source row when multiple citations point at the same displayed source', () => {
    const retrieval = message().retrieval;
    if (retrieval === undefined) {
      throw new Error('Expected message retrieval to be available.');
    }

    render(
      <CitationList
        heading="Sources"
        message={{
          ...message(),
          citations: [
            { sourceId: 'chunk-a', usedFor: 'first detail' },
            { sourceId: 'chunk-b', usedFor: 'second detail' },
          ],
          retrieval: {
            ...retrieval,
            evidence: [
              {
                ...baseEvidence(),
                id: 'chunk-a',
                title: 'Evidence Page Title',
                publicUrl: 'https://example.com/fishing/float-basics',
              },
              {
                ...baseEvidence(),
                id: 'chunk-b',
                title: 'Evidence Page Title',
                publicUrl: 'https://example.com/fishing/float-basics',
                quote: 'Another safe quote.',
              },
            ],
          },
        }}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    expect(screen.getAllByText('Evidence Page Title')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Evidence Page Title/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /more sources/i })).not.toBeInTheDocument();
  });

  it('redacts image filenames from missing-information items', () => {
    render(
      <MissingInformation
        heading="Missing"
        items={[
          'Nie mam tekstu z pliku sample-hidden.png ani https://blocked.example.invalid/code.',
        ]}
      />
    );

    expect(document.body.textContent).toContain('[image hidden]');
    expect(document.body.textContent).toContain('[link hidden]');
    expect(document.body.textContent).not.toContain('sample-hidden.png');
    expect(document.body.textContent).not.toContain('blocked.example.invalid');
  });

  it('uses counted expand and collapse labels for hidden sources', () => {
    const retrieval = message().retrieval;
    if (retrieval === undefined) {
      throw new Error('Expected message retrieval to be available.');
    }

    const manyCitationsMessage = {
      ...message(),
      citations: [
        { sourceId: 'knowledge-service\u0000knowledge-page:abc', usedFor: 'answer' },
        { sourceId: 'source-2', usedFor: 'answer' },
        { sourceId: 'source-3', usedFor: 'answer' },
        { sourceId: 'source-4', usedFor: 'answer' },
        { sourceId: 'source-5', usedFor: 'answer' },
      ],
      retrieval: {
        ...retrieval,
        evidence: [
          baseEvidence(),
          {
            ...baseEvidence(),
            id: 'source-2',
            title: 'Source Two',
            publicUrl: 'https://example.com/fishing/source-two',
          },
          {
            ...baseEvidence(),
            id: 'source-3',
            title: 'Source Three',
            publicUrl: 'https://example.com/fishing/source-three',
          },
          {
            ...baseEvidence(),
            id: 'source-4',
            title: 'Source Four',
            publicUrl: 'https://example.com/fishing/source-four',
          },
          {
            ...baseEvidence(),
            id: 'source-5',
            title: 'Source Five',
            publicUrl: 'https://example.com/fishing/source-five',
          },
        ],
      },
    };

    render(
      <CitationList
        heading="Sources"
        message={manyCitationsMessage}
        showAllLabel="Show all"
        {...sourceLabels}
      />
    );

    const expandButton = screen.getByRole('button', { name: 'Show 2 more sources' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expandButton);

    expect(screen.getByRole('button', { name: 'Hide 2 additional sources' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});

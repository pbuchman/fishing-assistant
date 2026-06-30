import { describe, expect, it } from 'vitest';

import { chunkMarkdown, inferMarkdownTitle } from './markdown.js';

describe('Markdown knowledge chunking', () => {
  it('infers titles from H1, first heading, filename, then fallback', () => {
    expect(inferMarkdownTitle('# H1 Title\n\nBody', 'file.md')).toBe('H1 Title');
    expect(inferMarkdownTitle('## First Heading\n\nBody', 'file.md')).toBe('First Heading');
    expect(inferMarkdownTitle('Body without headings', 'filename-fallback.md')).toBe(
      'filename-fallback'
    );
    expect(inferMarkdownTitle('Body without headings', '.md')).toBe('Untitled Document');
    expect(inferMarkdownTitle('Body without headings')).toBe('Untitled Document');
  });

  it('uses an explicit title override for chunk metadata and searchable text', () => {
    const result = chunkMarkdown({
      title: 'Page Record Title',
      filename: 'notes.md',
      markdown: '# Markdown Heading\n\n## Swim One\n\nUse pellets.',
    });

    expect(result.title).toBe('Page Record Title');
    expect(result.chunks).toEqual([
      expect.objectContaining({
        headingPath: ['Markdown Heading', 'Swim One'],
        searchableText: 'Page Record Title\n\nSwim One\n\nUse pellets.',
      }),
    ]);
  });

  it('chunks by Markdown headings and preserves heading paths', () => {
    const result = chunkMarkdown({
      filename: 'notes.md',
      markdown: '# Lake Notes\n\n## Swim One\n\nUse pellets.\n\n## Swim Two\n\nUse corn.',
    });

    expect(result.title).toBe('Lake Notes');
    expect(result.chunks).toEqual([
      expect.objectContaining({
        headingPath: ['Lake Notes', 'Swim One'],
        text: 'Use pellets.',
        searchableText: 'Lake Notes\n\nSwim One\n\nUse pellets.',
      }),
      expect.objectContaining({
        headingPath: ['Lake Notes', 'Swim Two'],
        text: 'Use corn.',
        searchableText: 'Lake Notes\n\nSwim Two\n\nUse corn.',
      }),
    ]);
  });

  it('splits oversized sections by paragraph boundaries', () => {
    const firstParagraph = 'first '.repeat(900).trim();
    const secondParagraph = 'second '.repeat(900).trim();
    const result = chunkMarkdown({
      filename: 'long.md',
      markdown: `# Long\n\n${firstParagraph}\n\n${secondParagraph}`,
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]?.text).toBe(firstParagraph);
    expect(result.chunks[1]?.text).toBe(secondParagraph);
  });

  it('does not split inside fenced code blocks', () => {
    const code = ['```text', 'line '.repeat(2_000).trim(), '```'].join('\n');
    const result = chunkMarkdown({
      filename: 'code.md',
      markdown: `# Code\n\n${code}`,
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.text).toBe(code);
  });

  it('infers and honors content types', () => {
    expect(
      chunkMarkdown({ markdown: '# Mix\n\nGroundbait recipe with pellets.' }).contentType
    ).toBe('recipe');
    expect(chunkMarkdown({ markdown: '# Carp\n\nCarp patrol the margin.' }).contentType).toBe(
      'species'
    );
    expect(chunkMarkdown({ markdown: '# Session\n\nWeather was cold.' }).contentType).toBe(
      'session-notes'
    );
    expect(
      chunkMarkdown({ markdown: '# FAQ\n\nQ: Which rig?\n\nAnswer: Method.' }).contentType
    ).toBe('qna');
    expect(chunkMarkdown({ markdown: '# Method\n\nHow to set up a feeder rig.' }).contentType).toBe(
      'guide'
    );
    expect(chunkMarkdown({ markdown: '# Notes\n\nA quiet paragraph.' }).contentType).toBe('other');
    expect(
      chunkMarkdown({ markdown: '# Override\n\nGroundbait recipe.', contentType: 'guide' })
        .contentType
    ).toBe('guide');
  });

  it('keeps mismatched fence markers inside the fenced block', () => {
    const result = chunkMarkdown({
      filename: 'fences.md',
      markdown: [
        '# Fences',
        '',
        '```text',
        '## Not a heading',
        '~~~',
        'still code',
        '```',
        '',
        '## Actual Heading',
        '',
        'Use corn.',
      ].join('\n'),
    });

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toEqual(
      expect.objectContaining({
        headingPath: ['Fences'],
        text: ['```text', '## Not a heading', '~~~', 'still code', '```'].join('\n'),
      })
    );
    expect(result.chunks[1]).toEqual(
      expect.objectContaining({
        headingPath: ['Fences', 'Actual Heading'],
        text: 'Use corn.',
      })
    );
  });

  it('splits a single oversized paragraph without exceeding the chunk size cap', () => {
    const longParagraph = 'pellet '.repeat(1_300).trim();
    const result = chunkMarkdown({
      filename: 'long-paragraph.md',
      markdown: `# Long Paragraph\n\n${longParagraph}`,
    });

    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) => chunk.text.length <= 7_200)).toBe(true);
    expect(result.chunks.every((chunk) => chunk.headingPath[0] === 'Long Paragraph')).toBe(true);
  });

  it('rejects documents over the chunk limit', () => {
    const markdown = Array.from(
      { length: 121 },
      (_value, index) => `## Section ${String(index)}\n\nBody ${String(index)}.`
    ).join('\n\n');

    expect(() => chunkMarkdown({ filename: 'huge.md', markdown })).toThrow(
      'Markdown document creates 121 chunks; maximum is 120.'
    );
  });
});

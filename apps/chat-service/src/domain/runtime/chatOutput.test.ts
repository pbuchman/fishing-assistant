import { describe, expect, it } from 'vitest';

import {
  chatOutputStructuredOutput,
  parseChatOutput,
  regenerableChatOutputErrorKind,
  recoverableChatOutputErrorKind,
} from './chatOutput.js';

const sourceAliases = new Map([
  ['S1', 'knowledge-page:source-1'],
  ['S2', 'knowledge-page:source-2'],
]);

describe('parseChatOutput', () => {
  it('parses fenced structured JSON, resolves aliases, and deduplicates sources', () => {
    const result = parseChatOutput(
      [
        '```json',
        JSON.stringify({
          answerMarkdown: 'Odpowiedź z **formatowaniem**. [S1]',
          confidence: 'high',
          usedSources: [
            { sourceId: 'S1', usedFor: 'primary evidence' },
            { sourceId: 'knowledge-page:source-1', usedFor: 'duplicate evidence' },
            { sourceId: 'unknown-source', usedFor: 'ignored evidence' },
            { sourceId: 'S2', usedFor: 'secondary evidence' },
          ],
          missingInformation: [
            { description: 'Brakuje dokładnej temperatury.', saveForAdmin: true },
          ],
          followUpQuestions: ['Doprecyzować łowisko?', 'Podać temperaturę?'],
        }),
        '```',
      ].join('\n'),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toEqual({
      answerMarkdown: 'Odpowiedź z **formatowaniem**.',
      confidence: 'high',
      usedSources: [
        { sourceId: 'knowledge-page:source-1', usedFor: 'primary evidence' },
        { sourceId: 'knowledge-page:source-2', usedFor: 'secondary evidence' },
      ],
      missingInformation: [{ description: 'Brakuje dokładnej temperatury.', saveForAdmin: true }],
      followUpQuestions: ['Doprecyzować łowisko?', 'Podać temperaturę?'],
    });
  });

  it('derives used sources from answer markers when usedSources has a loose object shape', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź oparta na pobranym źródle. [S1]',
        confidence: 'medium',
        usedSources: {},
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.usedSources).toEqual([
      { sourceId: 'knowledge-page:source-1', usedFor: 'cited in answerMarkdown' },
    ]);
  });

  it('accepts string usedSources entries only when they match answer markers', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź oparta na dwóch źródłach. [S1][S2]',
        confidence: 'medium',
        usedSources: ['S1', 'S2'],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.usedSources).toEqual([
      { sourceId: 'knowledge-page:source-1', usedFor: 'cited in answerMarkdown' },
      { sourceId: 'knowledge-page:source-2', usedFor: 'cited in answerMarkdown' },
    ]);
  });

  it('falls back to answer markers when usedSources objects are missing source ids', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź oparta na pobranym źródle. [S1]',
        confidence: 'medium',
        usedSources: [{ sourceId: '', usedFor: 'missing id from model output' }],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.usedSources).toEqual([
      { sourceId: 'knowledge-page:source-1', usedFor: 'cited in answerMarkdown' },
    ]);
  });

  it('extracts a JSON object from surrounding model prose and defaults unknown confidence', () => {
    const result = parseChatOutput(
      `Pewnie:\n${JSON.stringify({
        answerMarkdown: 'Krótka odpowiedź.',
        confidence: 'certain',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: ['Pierwsze?', 'Drugie?', 'Trzecie?', 'Czwarte?'],
      })}\nKoniec.`,
      { sourceAliases: new Map() }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.confidence).toBe('medium');
    expect(result.value.followUpQuestions).toEqual(['Pierwsze?', 'Drugie?', 'Trzecie?']);
  });

  it('normalizes loose missingInformation metadata without failing the answer', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź pozostaje kompletna mimo luźnych metadanych.',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [
          'Brakuje temperatury wody.',
          { description: 'Brakuje regulaminu zawodów.', saveForAdmin: 'true' },
          { description: 'Brakuje głębokości łowiska.', saveForAdmin: true },
          42,
          '',
          { description: '', saveForAdmin: true },
        ],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.missingInformation).toEqual([
      { description: 'Brakuje temperatury wody.', saveForAdmin: false },
      { description: 'Brakuje regulaminu zawodów.', saveForAdmin: false },
      { description: 'Brakuje głębokości łowiska.', saveForAdmin: true },
    ]);
  });

  it('recovers loose truncated JSON when the main string fields and arrays are readable', () => {
    const result = parseChatOutput(
      [
        '{',
        '"answerMarkdown": "Linia pierwsza\\nlinia druga z \\"cytatem\\"",',
        '"confidence": "low",',
        '"usedSources": [{"sourceId": "S1", "usedFor": "dowód"}],',
        '"missingInformation": [{"description": "brak danych", "saveForAdmin": false}],',
        '"followUpQuestions": ["Czy podać więcej?"]',
      ].join('\n'),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.answerMarkdown).toContain('Linia pierwsza');
    expect(result.value.answerMarkdown).toContain('"cytatem"');
    expect(result.value.confidence).toBe('low');
    expect(result.value.usedSources).toEqual([
      { sourceId: 'knowledge-page:source-1', usedFor: 'dowód' },
    ]);
    expect(result.value.missingInformation).toEqual([]);
    expect(result.value.followUpQuestions).toEqual([]);
  });

  it('uses plain text recovery only for non-json-looking text', () => {
    const result = parseChatOutput('"Model oddał zwykły tekst bez końcowego cudzysłowu', {
      sourceAliases,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value).toMatchObject({
      answerMarkdown: 'Model oddał zwykły tekst bez końcowego cudzysłowu',
      confidence: 'medium',
      usedSources: [],
      missingInformation: [],
      followUpQuestions: [],
    });
  });

  it('exposes the structured output request shape', () => {
    expect(chatOutputStructuredOutput).toEqual({ type: 'json_object' });
  });

  it('rejects placeholder-only answer text as non-substantive', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: '- ...',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.error.message).toBe('answerMarkdown must contain a substantive answer');
  });

  it('rejects short answers that refer to omitted content outside JSON', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Tabela i omówienie powyżej. Chcesz konkretny wariant?',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.error.message).toBe(
      'answerMarkdown must be self-contained and not refer to content outside the JSON'
    );
  });

  it('rejects short meta answers that point to previous or external text', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Powyższa treść to pełna odpowiedź.\n\n- Czy mam doprecyzować obserwacje?',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: ['Czy mam doprecyzować obserwacje?'],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.error.message).toBe(
      'answerMarkdown must be self-contained and not refer to content outside the JSON'
    );
  });

  it('strips provider control-channel artifacts from public answer markdown', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: [
          'Gotowa odpowiedź dla użytkownika. [S1]',
          ']<]minimax[>[<tool_call>',
          ']<]minimax[>[<invoke name="retrieveKnowledge">]',
          ']<]minimax[>[<query>sekret techniczny</query>]',
          ']<]minimax[>[</invoke>',
          ']<]minimax[>[</tool_call>',
        ].join('\n'),
        confidence: 'medium',
        usedSources: [{ sourceId: 'S1', usedFor: 'dowód' }],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.answerMarkdown).toBe('Gotowa odpowiedź dla użytkownika.');
    expect(result.value.answerMarkdown).not.toContain('tool_call');
    expect(result.value.answerMarkdown).not.toContain('retrieveKnowledge');
  });

  it('rejects source markers when no retrieved evidence aliases exist', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź z niepopartym markerem źródła. [S1]',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases: new Map() }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.error.message).toBe(
      'answerMarkdown contains source markers without retrieved evidence'
    );
  });

  it('rejects source markers that do not match retrieved aliases', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź z obcym markerem źródła. [S50]',
        confidence: 'medium',
        usedSources: [{ sourceId: 'S1', usedFor: 'known source' }],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.error.message).toBe('answerMarkdown contains unknown source marker S50');
  });

  it('adds cited source markers that are missing from usedSources', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown: 'Odpowiedź oparta na dwóch źródłach. [S1][S2]',
        confidence: 'medium',
        usedSources: [{ sourceId: 'S1', usedFor: 'first source' }],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.usedSources).toEqual([
      { sourceId: 'knowledge-page:source-1', usedFor: 'first source' },
      { sourceId: 'knowledge-page:source-2', usedFor: 'cited in answerMarkdown' },
    ]);
  });

  it('removes resolved source markers from public answer markdown while preserving citations', () => {
    const result = parseChatOutput(
      JSON.stringify({
        answerMarkdown:
          'Muliste dno wymaga mikro-prezentacji [S1], a dodatek powinien budować punkt na dnie. [S2]',
        confidence: 'high',
        usedSources: [
          { sourceId: 'S1', usedFor: 'soft bottom presentation' },
          { sourceId: 'S2', usedFor: 'bottom-focused additive' },
        ],
        missingInformation: [],
        followUpQuestions: [],
      }),
      { sourceAliases }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.answerMarkdown).toBe(
      'Muliste dno wymaga mikro-prezentacji, a dodatek powinien budować punkt na dnie.'
    );
    expect(result.value.usedSources).toEqual([
      { sourceId: 'knowledge-page:source-1', usedFor: 'soft bottom presentation' },
      { sourceId: 'knowledge-page:source-2', usedFor: 'bottom-focused additive' },
    ]);
  });

  it.each([
    {
      name: 'empty text',
      text: '',
      message: 'Unexpected end of JSON input',
    },
    {
      name: 'array json',
      text: '[]',
      message: 'chat output JSON must be an object',
    },
    {
      name: 'missing answer',
      text: JSON.stringify({
        confidence: 'high',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [],
      }),
      message: 'answerMarkdown must be a non-empty string',
    },
    {
      name: 'invalid confidence type',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 1,
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [],
      }),
      message: 'confidence must be a string',
    },
    {
      name: 'usedSources is not array',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 'medium',
        usedSources: {},
        missingInformation: [],
        followUpQuestions: [],
      }),
      message: 'usedSources must be an array',
    },
    {
      name: 'usedSources item is not object',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 'medium',
        usedSources: ['S1'],
        missingInformation: [],
        followUpQuestions: [],
      }),
      message: 'usedSources items must be objects',
    },
    {
      name: 'usedSources source id is missing',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 'medium',
        usedSources: [{ sourceId: '', usedFor: 'dowód' }],
        missingInformation: [],
        followUpQuestions: [],
      }),
      message: 'usedSources.sourceId must be a non-empty string',
    },
    {
      name: 'usedSources usedFor is missing',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 'medium',
        usedSources: [{ sourceId: 'S1', usedFor: '' }],
        missingInformation: [],
        followUpQuestions: [],
      }),
      message: 'usedSources.usedFor must be a non-empty string',
    },
    {
      name: 'follow-up questions is not array',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: {},
      }),
      message: 'followUpQuestions must be an array',
    },
    {
      name: 'follow-up item is not text',
      text: JSON.stringify({
        answerMarkdown: 'Tak.',
        confidence: 'medium',
        usedSources: [],
        missingInformation: [],
        followUpQuestions: [1],
      }),
      message: 'followUpQuestions item must be a non-empty string',
    },
  ])('rejects invalid output: $name', ({ text, message }) => {
    const result = parseChatOutput(text, { sourceAliases });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected parse failure');
    }
    expect(result.error).toMatchObject({ code: 'INVALID_OUTPUT', message });
  });
});

describe('recoverableChatOutputErrorKind', () => {
  it('classifies array shape errors as recoverable', () => {
    expect(recoverableChatOutputErrorKind('usedSources must be an array')).toBe('array_shape');
    expect(recoverableChatOutputErrorKind('usedSources items must be objects')).toBe('array_shape');
    expect(recoverableChatOutputErrorKind('usedSources.usedFor must be a non-empty string')).toBe(
      'array_shape'
    );
    expect(recoverableChatOutputErrorKind('missingInformation must be an array')).toBe(
      'array_shape'
    );
    expect(recoverableChatOutputErrorKind('missingInformation items must be objects')).toBe(
      'array_shape'
    );
    expect(recoverableChatOutputErrorKind('followUpQuestions must be an array')).toBe(
      'array_shape'
    );
    expect(
      recoverableChatOutputErrorKind('followUpQuestions item must be a non-empty string')
    ).toBe('array_shape');
  });

  it('classifies invalid JSON as recoverable', () => {
    expect(recoverableChatOutputErrorKind('Unexpected end of JSON input')).toBe('invalid_json');
    expect(recoverableChatOutputErrorKind("Unexpected token '}' in JSON at position 42")).toBe(
      'invalid_json'
    );
    expect(
      recoverableChatOutputErrorKind(
        'Unexpected non-whitespace character after JSON at position 85 (line 1 column 86)'
      )
    ).toBe('invalid_json');
    expect(recoverableChatOutputErrorKind('chat output was not valid JSON')).toBe('invalid_json');
  });

  it('does not recover missing answerMarkdown because there is no answer to save', () => {
    expect(recoverableChatOutputErrorKind('answerMarkdown must be a non-empty string')).toBeNull();
  });
});

describe('regenerableChatOutputErrorKind', () => {
  it('classifies semantic answer failures as regenerable with the original evidence', () => {
    expect(regenerableChatOutputErrorKind('answerMarkdown must contain a substantive answer')).toBe(
      'semantic_output'
    );
    expect(
      regenerableChatOutputErrorKind(
        'answerMarkdown must be self-contained and not refer to content outside the JSON'
      )
    ).toBe('semantic_output');
  });

  it('does not classify syntax or shape failures for grounded regeneration', () => {
    expect(regenerableChatOutputErrorKind('Unexpected end of JSON input')).toBeNull();
    expect(regenerableChatOutputErrorKind('usedSources must be an array')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  compactFinalAnswerRetryMessages,
  regenerateInvalidFinalAnswerMessages,
  repairStructuredChatOutputMessages,
} from './chatOutputRecovery.js';

describe('chat output recovery prompts', () => {
  it('builds a compact retry instruction for length-truncated answers', () => {
    const messages = compactFinalAnswerRetryMessages({
      finalAnswerMessages: [
        { role: 'system', content: 'Ground the answer in the retrieved evidence.' },
        { role: 'user', content: 'Wcześniej łowiłem w mule.' },
        {
          role: 'tool',
          toolCallId: 'tool-1',
          name: 'retrieveKnowledge',
          content:
            '{"instruction":"Use only these sourceId aliases","evidence":[{"sourceId":"S1","content":"Twardy żwir wzmacnia logikę larw."}]}',
        },
      ],
      originalQuestion: 'Gdzie położyć zestaw?',
      previousFinishReason: 'length',
      truncatedAnswer: '{"answerMarkdown":"Ucięta odpowiedź [S1]"}',
    });

    const content = messages.map((message) => message.content).join('\n');
    expect(messages.slice(0, 3)).toEqual([
      { role: 'system', content: 'Ground the answer in the retrieved evidence.' },
      { role: 'user', content: 'Wcześniej łowiłem w mule.' },
      {
        role: 'tool',
        toolCallId: 'tool-1',
        name: 'retrieveKnowledge',
        content:
          '{"instruction":"Use only these sourceId aliases","evidence":[{"sourceId":"S1","content":"Twardy żwir wzmacnia logikę larw."}]}',
      },
    ]);
    expect(content).toContain('Return valid JSON only');
    expect(content).toContain('answerMarkdown');
    expect(content).toContain('Keep the answer compact');
    expect(content).toContain('Gdzie położyć zestaw?');
    expect(content).toContain('Use only these sourceId aliases');
    expect(content).toContain('Ucięta odpowiedź [S1]');
  });

  it('clips very long previous answers in compact retry instructions', () => {
    const longAnswer = `${'początek '.repeat(800)} ŚRODEK ${'koniec '.repeat(800)}`;
    const messages = compactFinalAnswerRetryMessages({
      finalAnswerMessages: [{ role: 'system', content: 'Ground the answer.' }],
      originalQuestion: 'Podsumuj decyzję.',
      previousFinishReason: 'length',
      truncatedAnswer: longAnswer,
    });

    const content = messages.map((message) => message.content).join('\n');
    expect(content).toContain('[previous answer clipped for compact retry]');
    expect(content).toContain('początek');
    expect(content).toContain('koniec');
    expect(content).not.toContain(longAnswer);
    expect(content.length).toBeLessThan(longAnswer.length);
  });

  it('builds a repair instruction that preserves answer text and repairs arrays', () => {
    const messages = repairStructuredChatOutputMessages({
      parseErrorMessage: 'missingInformation must be an array',
      malformedOutput: '{"answerMarkdown":"Tak","missingInformation":{}}',
    });

    const content = messages.map((message) => message.content).join('\n');
    expect(content).toContain('missingInformation must be an array');
    expect(content).toContain('Do not add new facts');
    expect(content).toContain('usedSources');
    expect(content).toContain('[]');
  });

  it('builds a grounded regeneration instruction for semantic answer failures', () => {
    const messages = regenerateInvalidFinalAnswerMessages({
      finalAnswerMessages: [
        { role: 'system', content: 'Ground the answer in the retrieved evidence.' },
        {
          role: 'tool',
          toolCallId: 'tool-1',
          name: 'retrieveKnowledge',
          content:
            '{"instruction":"Use only these sourceId aliases","evidence":[{"sourceId":"S1","content":"Zima: mała dawka. Lato: większa dawka."}]}',
        },
      ],
      originalQuestion: 'Podaj zakresy w tabeli.',
      parseErrorMessage:
        'answerMarkdown must be self-contained and not refer to content outside the JSON',
      invalidAnswer: '{"answerMarkdown":"Tabela powyżej."}',
    });

    const content = messages.map((message) => message.content).join('\n');
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'Ground the answer in the retrieved evidence.',
    });
    expect(content).toContain('same conversation and retrieved evidence');
    expect(content).toContain('answerMarkdown field must be self-contained');
    expect(content).toContain('Do not refer to text outside the JSON');
    expect(content).toContain('Podaj zakresy w tabeli.');
    expect(content).toContain('Tabela powyżej.');
  });
});

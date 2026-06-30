import type { ChatMessage } from '@fa/llm-contract';

export type FinalAnswerRetryReason = 'finish_length' | 'parse_error';

export interface CompactFinalAnswerRetryInput {
  finalAnswerMessages: readonly ChatMessage[];
  originalQuestion: string;
  previousFinishReason: string;
  truncatedAnswer: string;
}

export interface RepairStructuredChatOutputInput {
  parseErrorMessage: string;
  malformedOutput: string;
}

export interface RegenerateInvalidFinalAnswerInput {
  finalAnswerMessages: readonly ChatMessage[];
  originalQuestion: string;
  parseErrorMessage: string;
  invalidAnswer: string;
}

const requiredShape = `{
  "answerMarkdown": "short Markdown answer",
  "confidence": "high|medium|low",
  "usedSources": [],
  "missingInformation": [],
  "followUpQuestions": []
}`;
const compactRetryPreviousAnswerMaxChars = 4_000;

function clipRetryContext(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  const headChars = Math.floor(maxChars * 0.65);
  const tailChars = maxChars - headChars;
  return [
    trimmed.slice(0, headChars).trimEnd(),
    '[previous answer clipped for compact retry]',
    trimmed.slice(-tailChars).trimStart(),
  ].join('\n');
}

export function compactFinalAnswerRetryMessages(
  input: CompactFinalAnswerRetryInput
): ChatMessage[] {
  return [
    ...input.finalAnswerMessages,
    {
      role: 'user',
      content: [
        'Return valid JSON only.',
        `The previous final answer ended with finishReason=${input.previousFinishReason}.`,
        'Regenerate the answer in the required JSON shape.',
        'Keep the answer compact, direct, and shorter than the previous attempt.',
        'Prioritize the original user question. Omit recap, filler, and broad restatement.',
        'Stay grounded in the same conversation and retrieved evidence already provided above.',
        'Reuse the same sourceId aliases from the retrieved evidence.',
        'Do not add new facts beyond the existing conversation and retrieved evidence.',
        'Do not include optional follow-up questions.',
        'Use arrays for usedSources, missingInformation, and followUpQuestions.',
        `Required shape:\n${requiredShape}`,
        `Original user question:\n${input.originalQuestion}`,
        `Truncated previous answer to compress:\n${clipRetryContext(
          input.truncatedAnswer,
          compactRetryPreviousAnswerMaxChars
        )}`,
      ].join('\n\n'),
    },
  ];
}

export function repairStructuredChatOutputMessages(
  input: RepairStructuredChatOutputInput
): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'Repair malformed chat JSON. Return valid JSON only. Do not add new facts. Do not rewrite the answer except where needed to produce valid JSON.',
    },
    {
      role: 'user',
      content: [
        `Parser error: ${input.parseErrorMessage}`,
        'Repair the output to this exact shape. The array fields must always be arrays. If a field is missing, null, object, or string, use [] unless the malformed output already contains valid array items.',
        `Required shape:\n${requiredShape}`,
        `Malformed output:\n${input.malformedOutput}`,
      ].join('\n\n'),
    },
  ];
}

export function regenerateInvalidFinalAnswerMessages(
  input: RegenerateInvalidFinalAnswerInput
): ChatMessage[] {
  return [
    ...input.finalAnswerMessages,
    {
      role: 'user',
      content: [
        'Return valid JSON only.',
        `The previous final answer was rejected by validation: ${input.parseErrorMessage}.`,
        'Regenerate the answer in the required JSON shape using the same conversation and retrieved evidence already provided above.',
        'The answerMarkdown field must be self-contained: put the actual answer inside answerMarkdown, including any requested table, list, comparison, quantities, or ranges.',
        'Do not refer to text outside the JSON, above, below, earlier, or later.',
        'Reuse the same sourceId aliases from the retrieved evidence.',
        'Do not add new facts beyond the existing conversation and retrieved evidence.',
        'Use arrays for usedSources, missingInformation, and followUpQuestions.',
        `Required shape:\n${requiredShape}`,
        `Original user question:\n${input.originalQuestion}`,
        `Rejected answer:\n${input.invalidAnswer}`,
      ].join('\n\n'),
    },
  ];
}

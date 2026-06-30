import { err, ok, type Result } from '@fa/common-core';
import type { ChatStructuredOutput } from '@fa/llm-contract';

import type { Citation } from '../models/chat.js';
import { sanitizePublicMarkdown } from '../text/publicMarkdown.js';

export interface ChatOutputMissingInformation {
  description: string;
  saveForAdmin: boolean;
}

export interface ChatOutput {
  answerMarkdown: string;
  confidence: 'high' | 'medium' | 'low';
  usedSources: Citation[];
  missingInformation: ChatOutputMissingInformation[];
  followUpQuestions: string[];
}

export interface ParseChatOutputOptions {
  sourceAliases: ReadonlyMap<string, string>;
}

export interface ParseChatOutputError {
  code: 'INVALID_OUTPUT';
  message: string;
}

export type RecoverableChatOutputErrorKind = 'invalid_json' | 'array_shape';
export type RegenerableChatOutputErrorKind = 'semantic_output';

const recoverableArrayShapeMessages = new Set([
  'usedSources must be an array',
  'missingInformation must be an array',
  'followUpQuestions must be an array',
]);

export function recoverableChatOutputErrorKind(
  message: string
): RecoverableChatOutputErrorKind | null {
  if (
    recoverableArrayShapeMessages.has(message) ||
    message === 'usedSources items must be objects' ||
    message.startsWith('usedSources.') ||
    message === 'missingInformation items must be objects' ||
    message.startsWith('missingInformation.') ||
    message === 'followUpQuestions item must be a non-empty string'
  ) {
    return 'array_shape';
  }

  if (
    message === 'chat output was not valid JSON' ||
    message.includes('Unexpected end of JSON input') ||
    message.includes('Unexpected non-whitespace character after JSON') ||
    message.includes('Unterminated string in JSON') ||
    message.includes('Unexpected token') ||
    message.includes('Expected')
  ) {
    return 'invalid_json';
  }

  return null;
}

export function regenerableChatOutputErrorKind(
  message: string
): RegenerableChatOutputErrorKind | null {
  if (
    message === 'answerMarkdown must contain a substantive answer' ||
    message === 'answerMarkdown must be self-contained and not refer to content outside the JSON' ||
    message === 'answerMarkdown contains source markers without retrieved evidence' ||
    message === 'answerMarkdown source markers must be listed in usedSources' ||
    message.startsWith('answerMarkdown contains unknown source marker ')
  ) {
    return 'semantic_output';
  }

  return null;
}

export const chatOutputStructuredOutput: ChatStructuredOutput = {
  type: 'json_object',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonCandidateText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }

  const firstObjectChar = trimmed.indexOf('{');
  const lastObjectChar = trimmed.lastIndexOf('}');
  if (firstObjectChar >= 0 && lastObjectChar > firstObjectChar) {
    return trimmed.slice(firstObjectChar, lastObjectChar + 1).trim();
  }

  return trimmed;
}

function unescapeLooseJsonString(value: string): string {
  return value
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t')
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, '\\');
}

function looseStringField(
  text: string,
  fieldName: string,
  nextFieldName: string
): string | undefined {
  const pattern = new RegExp(
    `"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"${nextFieldName}"`,
    'u'
  );
  return pattern.exec(text)?.[1];
}

function looseArrayBlock(
  text: string,
  fieldName: string,
  nextFieldName: string
): string | undefined {
  const pattern = new RegExp(
    `"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*"${nextFieldName}"`,
    'u'
  );
  return pattern.exec(text)?.[1];
}

function looseLastArrayBlock(text: string, fieldName: string): string | undefined {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*\\}?\\s*$`, 'u');
  return pattern.exec(text)?.[1];
}

function parseLooseUsedSources(block: string | undefined): unknown[] {
  if (block === undefined || block.trim().length === 0) {
    return [];
  }

  return [...block.matchAll(/"sourceId"\s*:\s*"([^"]+)"[\s\S]*?"usedFor"\s*:\s*"([^"]*)"/gu)]
    .map((match) => ({
      sourceId: unescapeLooseJsonString(match[1] ?? ''),
      usedFor: unescapeLooseJsonString(match[2] ?? ''),
    }))
    .filter((item) => item.sourceId.length > 0 && item.usedFor.length > 0);
}

function parseLooseMissingInformation(block: string | undefined): unknown[] {
  if (block === undefined || block.trim().length === 0) {
    return [];
  }

  return [
    ...block.matchAll(/"description"\s*:\s*"([\s\S]*?)"\s*,\s*"saveForAdmin"\s*:\s*(true|false)/gu),
  ].map((match) => ({
    description: unescapeLooseJsonString(match[1] ?? ''),
    saveForAdmin: match[2] === 'true',
  }));
}

function parseLooseFollowUpQuestions(block: string | undefined): unknown[] {
  if (block === undefined || block.trim().length === 0) {
    return [];
  }

  return [...block.matchAll(/"([^"]+)"/gu)].map((match) => unescapeLooseJsonString(match[1] ?? ''));
}

function parseLooseChatOutputObject(
  text: string
): Result<Record<string, unknown>, ParseChatOutputError> {
  const answerMarkdown = looseStringField(text, 'answerMarkdown', 'confidence');
  const confidence = /"confidence"\s*:\s*"(high|medium|low)"/u.exec(text)?.[1];
  if (answerMarkdown === undefined || confidence === undefined) {
    return err({ code: 'INVALID_OUTPUT', message: 'chat output was not valid JSON' });
  }

  return ok({
    answerMarkdown: unescapeLooseJsonString(answerMarkdown),
    confidence,
    usedSources: parseLooseUsedSources(looseArrayBlock(text, 'usedSources', 'missingInformation')),
    missingInformation: parseLooseMissingInformation(
      looseArrayBlock(text, 'missingInformation', 'followUpQuestions')
    ),
    followUpQuestions: parseLooseFollowUpQuestions(looseLastArrayBlock(text, 'followUpQuestions')),
  });
}

function parsePlainTextChatOutputObject(
  text: string
): Result<Record<string, unknown>, ParseChatOutputError> {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return err({ code: 'INVALID_OUTPUT', message: 'chat output was not valid JSON' });
  }

  const unquoted =
    trimmed.startsWith('"') && !trimmed.endsWith('"') ? trimmed.slice(1).trimStart() : trimmed;
  if (unquoted.length === 0) {
    return err({ code: 'INVALID_OUTPUT', message: 'chat output was not valid JSON' });
  }

  return ok({
    answerMarkdown: unescapeLooseJsonString(unquoted),
    confidence: 'medium',
    usedSources: [],
    missingInformation: [],
    followUpQuestions: [],
  });
}

function parseJson(text: string): Result<Record<string, unknown>, ParseChatOutputError> {
  const candidate = jsonCandidateText(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch (error) {
    const looseParsed = parseLooseChatOutputObject(candidate);
    if (looseParsed.ok) {
      return looseParsed;
    }
    const plainTextParsed = parsePlainTextChatOutputObject(candidate);
    if (plainTextParsed.ok) {
      return plainTextParsed;
    }
    return err({
      code: 'INVALID_OUTPUT',
      message: error instanceof Error ? error.message : 'chat output was not valid JSON',
    });
  }

  if (!isRecord(parsed)) {
    return err({ code: 'INVALID_OUTPUT', message: 'chat output JSON must be an object' });
  }

  return ok(parsed);
}

function textField(value: unknown, fieldName: string): Result<string, ParseChatOutputError> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return err({ code: 'INVALID_OUTPUT', message: `${fieldName} must be a non-empty string` });
  }

  return ok(sanitizePublicMarkdown(value).trim());
}

function substantiveTextField(
  value: unknown,
  fieldName: string
): Result<string, ParseChatOutputError> {
  const text = textField(value, fieldName);
  if (!text.ok) {
    return text;
  }

  if (isPlaceholderOnlyText(text.value)) {
    return err({ code: 'INVALID_OUTPUT', message: `${fieldName} must contain substantive text` });
  }

  return text;
}

function normalizedSemanticText(value: string): string {
  return sanitizePublicMarkdown(value).replace(/\s+/gu, ' ').trim().toLocaleLowerCase('pl-PL');
}

function isPlaceholderOnlyText(value: string): boolean {
  const normalized = normalizedSemanticText(value);
  if (normalized.length === 0) {
    return true;
  }

  return normalized.replace(/[.\-–—•*_\s…"'`]+/gu, '').length === 0;
}

const externalReferenceWords = String.raw`(?:powy[żz]ej|powy[żz]sz\w*|poni[żz]ej|poni[żz]sz\w*|wy[żz]ej|ni[żz]ej|above|below|previous|earlier|later)`;
const answerContainerWords = String.raw`(?:tabela|tabeli|om[oó]wienie|odpowied[źz]|opis|lista|sekcja|wyja[sś]nienie|informacja|informacje|zestawienie|przyk[łl]ad|analiza|tre[sś][cć]|tekst)`;
const metaReferencePattern = new RegExp(
  [
    String.raw`${answerContainerWords}.{0,80}${externalReferenceWords}`,
    String.raw`${externalReferenceWords}.{0,80}${answerContainerWords}`,
    String.raw`(?:jak|zgodnie z|patrz|zobacz|see|as).{0,60}${externalReferenceWords}`,
  ].join('|'),
  'iu'
);

function validateAnswerMarkdown(value: string): Result<string, ParseChatOutputError> {
  if (isPlaceholderOnlyText(value)) {
    return err({
      code: 'INVALID_OUTPUT',
      message: 'answerMarkdown must contain a substantive answer',
    });
  }

  const normalized = normalizedSemanticText(value);
  if (normalized.length <= 700 && metaReferencePattern.test(normalized)) {
    return err({
      code: 'INVALID_OUTPUT',
      message: 'answerMarkdown must be self-contained and not refer to content outside the JSON',
    });
  }

  return ok(value);
}

function answerSourceMarkers(value: string): string[] {
  const seen = new Set<string>();
  const markers: string[] = [];
  for (const match of value.matchAll(/\[S([1-9]\d*)\]/gu)) {
    const markerNumber = match[1];
    if (markerNumber === undefined) {
      continue;
    }
    const marker = `S${markerNumber}`;
    if (seen.has(marker)) {
      continue;
    }
    seen.add(marker);
    markers.push(marker);
  }

  return markers;
}

function stripAnswerSourceMarkers(value: string): string {
  return value
    .replace(/[ \t]*(?:\[S[1-9]\d*\])+/gu, '')
    .replace(/[ \t]+([,.;:!?])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

const fallbackCitationUsedFor = 'cited in answerMarkdown';

function addResolvedCitation(input: {
  citations: Citation[];
  seen: Set<string>;
  rawSourceId: string;
  usedFor: string;
  aliases: ReadonlyMap<string, string>;
  allowedSourceIds: ReadonlySet<string>;
}): boolean {
  const sourceId = input.rawSourceId.trim();
  if (sourceId.length === 0) {
    return false;
  }

  const resolvedSourceId = input.aliases.get(sourceId) ?? sourceId;
  if (input.aliases.size > 0 && !input.allowedSourceIds.has(resolvedSourceId)) {
    return false;
  }
  if (input.seen.has(resolvedSourceId)) {
    return true;
  }

  const usedFor = input.usedFor.trim() || fallbackCitationUsedFor;
  input.seen.add(resolvedSourceId);
  input.citations.push({ sourceId: resolvedSourceId, usedFor });
  return true;
}

function citationsFromAnswerMarkers(
  answerMarkdown: string,
  aliases: ReadonlyMap<string, string>
): Citation[] {
  const allowedSourceIds = new Set(aliases.values());
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const marker of answerSourceMarkers(answerMarkdown)) {
    addResolvedCitation({
      citations,
      seen,
      rawSourceId: marker,
      usedFor: fallbackCitationUsedFor,
      aliases,
      allowedSourceIds,
    });
  }

  return citations;
}

function validateAnswerSourceMarkers(
  answerMarkdown: string,
  aliases: ReadonlyMap<string, string>,
  usedSources: readonly Citation[]
): Result<void, ParseChatOutputError> {
  const markers = answerSourceMarkers(answerMarkdown);
  if (markers.length === 0) {
    return ok(undefined);
  }

  if (aliases.size === 0) {
    return err({
      code: 'INVALID_OUTPUT',
      message: 'answerMarkdown contains source markers without retrieved evidence',
    });
  }

  const usedSourceIds = new Set(usedSources.map((source) => source.sourceId));
  for (const marker of markers) {
    const resolvedSourceId = aliases.get(marker);
    if (resolvedSourceId === undefined) {
      return err({
        code: 'INVALID_OUTPUT',
        message: `answerMarkdown contains unknown source marker ${marker}`,
      });
    }
    if (!usedSourceIds.has(resolvedSourceId)) {
      return err({
        code: 'INVALID_OUTPUT',
        message: 'answerMarkdown source markers must be listed in usedSources',
      });
    }
  }

  return ok(undefined);
}

function confidenceField(value: unknown): Result<ChatOutput['confidence'], ParseChatOutputError> {
  if (value === 'high' || value === 'medium' || value === 'low') {
    return ok(value);
  }

  if (value === undefined || typeof value === 'string') {
    return ok('medium');
  }

  return err({ code: 'INVALID_OUTPUT', message: 'confidence must be a string' });
}

function arrayField(value: unknown, fieldName: string): Result<unknown[], ParseChatOutputError> {
  if (!Array.isArray(value)) {
    return err({ code: 'INVALID_OUTPUT', message: `${fieldName} must be an array` });
  }

  return ok(value);
}

function parseUsedSources(
  value: unknown,
  aliases: ReadonlyMap<string, string>,
  answerMarkdown: string
): Result<Citation[], ParseChatOutputError> {
  const items = arrayField(value, 'usedSources');
  if (!items.ok) {
    const markerCitations = citationsFromAnswerMarkers(answerMarkdown, aliases);
    if (markerCitations.length > 0) {
      return ok(markerCitations);
    }
    return items;
  }

  const allowedSourceIds = new Set(aliases.values());
  const seen = new Set<string>();
  const citations: Citation[] = [];
  const markerCitations = citationsFromAnswerMarkers(answerMarkdown, aliases);
  const markerSet = new Set(answerSourceMarkers(answerMarkdown));
  for (const item of items.value) {
    if (typeof item === 'string' && markerSet.has(item.trim())) {
      addResolvedCitation({
        citations,
        seen,
        rawSourceId: item,
        usedFor: fallbackCitationUsedFor,
        aliases,
        allowedSourceIds,
      });
      continue;
    }

    if (!isRecord(item)) {
      if (markerCitations.length > 0) {
        return ok(markerCitations);
      }
      return err({ code: 'INVALID_OUTPUT', message: 'usedSources items must be objects' });
    }

    const sourceId = textField(
      item['sourceId'] ?? item['alias'] ?? item['sourceAlias'] ?? item['source'] ?? item['id'],
      'usedSources.sourceId'
    );
    if (!sourceId.ok) {
      if (markerCitations.length > 0) {
        return ok(markerCitations);
      }
      return sourceId;
    }
    const rawUsedFor = item['usedFor'];
    if (typeof rawUsedFor !== 'string' || rawUsedFor.trim().length === 0) {
      if (markerSet.has(sourceId.value.trim())) {
        addResolvedCitation({
          citations,
          seen,
          rawSourceId: sourceId.value,
          usedFor: fallbackCitationUsedFor,
          aliases,
          allowedSourceIds,
        });
        continue;
      }
      return err({
        code: 'INVALID_OUTPUT',
        message: 'usedSources.usedFor must be a non-empty string',
      });
    }

    const added = addResolvedCitation({
      citations,
      seen,
      rawSourceId: sourceId.value,
      usedFor: rawUsedFor,
      aliases,
      allowedSourceIds,
    });
    if (!added) {
      continue;
    }
  }

  for (const markerCitation of markerCitations) {
    if (seen.has(markerCitation.sourceId)) {
      continue;
    }
    seen.add(markerCitation.sourceId);
    citations.push(markerCitation);
  }

  return ok(citations);
}

function parseMissingInformation(
  value: unknown
): Result<ChatOutputMissingInformation[], ParseChatOutputError> {
  const items = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : typeof value === 'string' || isRecord(value)
        ? [value]
        : [];

  if (items.length === 0) {
    return ok([]);
  }

  const missingInformation: ChatOutputMissingInformation[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const description = substantiveTextField(item, 'missingInformation.description');
      if (description.ok) {
        missingInformation.push({
          description: description.value,
          saveForAdmin: false,
        });
      }
      continue;
    }

    if (!isRecord(item)) {
      continue;
    }

    const description = substantiveTextField(item['description'], 'missingInformation.description');
    if (!description.ok) {
      continue;
    }

    missingInformation.push({
      description: description.value,
      saveForAdmin: item['saveForAdmin'] === true,
    });
  }

  return ok(missingInformation);
}

function parseFollowUpQuestions(value: unknown): Result<string[], ParseChatOutputError> {
  const items = arrayField(value, 'followUpQuestions');
  if (!items.ok) {
    return items;
  }

  const questions: string[] = [];
  for (const item of items.value) {
    const question = substantiveTextField(item, 'followUpQuestions item');
    if (!question.ok) {
      return question;
    }
    questions.push(question.value);
  }

  return ok(questions.slice(0, 3));
}

export function parseChatOutput(
  text: string,
  options: ParseChatOutputOptions
): Result<ChatOutput, ParseChatOutputError> {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return parsed;
  }

  const answerMarkdown = textField(parsed.value['answerMarkdown'], 'answerMarkdown');
  if (!answerMarkdown.ok) {
    return answerMarkdown;
  }
  const validAnswerMarkdown = validateAnswerMarkdown(answerMarkdown.value);
  if (!validAnswerMarkdown.ok) {
    return validAnswerMarkdown;
  }
  const confidence = confidenceField(parsed.value['confidence']);
  if (!confidence.ok) {
    return confidence;
  }
  const usedSources = parseUsedSources(
    parsed.value['usedSources'],
    options.sourceAliases,
    validAnswerMarkdown.value
  );
  if (!usedSources.ok) {
    return usedSources;
  }
  const validSourceMarkers = validateAnswerSourceMarkers(
    validAnswerMarkdown.value,
    options.sourceAliases,
    usedSources.value
  );
  if (!validSourceMarkers.ok) {
    return validSourceMarkers;
  }
  const publicAnswerMarkdown = validateAnswerMarkdown(
    stripAnswerSourceMarkers(validAnswerMarkdown.value)
  );
  if (!publicAnswerMarkdown.ok) {
    return publicAnswerMarkdown;
  }
  const missingInformation = parseMissingInformation(parsed.value['missingInformation']);
  if (!missingInformation.ok) {
    return missingInformation;
  }
  const followUpQuestions = parseFollowUpQuestions(parsed.value['followUpQuestions']);
  if (!followUpQuestions.ok) {
    return followUpQuestions;
  }

  return ok({
    answerMarkdown: publicAnswerMarkdown.value,
    confidence: confidence.value,
    usedSources: usedSources.value,
    missingInformation: missingInformation.value,
    followUpQuestions: followUpQuestions.value,
  });
}

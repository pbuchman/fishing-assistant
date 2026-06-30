import { sanitizePublicMarkdown } from '../text/publicMarkdown.js';

const unsafeExtendedPictographPattern = /\p{Extended_Pictographic}/u;

function isUnsafePromptCharacter(value: string): boolean {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  if (
    (codePoint >= 0x00 && codePoint <= 0x08) ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    codePoint === 0x7f
  ) {
    return true;
  }

  return (
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    unsafeExtendedPictographPattern.test(value)
  );
}

function stripUnsafePromptCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    result += isUnsafePromptCharacter(character) ? ' ' : character;
  }
  return result;
}

export function sanitizePromptText(value: string): string {
  return stripUnsafePromptCharacters(sanitizePublicMarkdown(value))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

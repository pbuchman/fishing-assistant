import { describe, expect, it } from 'vitest';
import { appMessages } from '@fa/i18n';

import { knowledgeAccessLabel } from './displayLabels.js';

describe('displayLabels', () => {
  it('renders Knowledge access gates as admin outcome labels', () => {
    expect(knowledgeAccessLabel('public', null, appMessages.pl)).toBe('Wszyscy');
    expect(knowledgeAccessLabel('approved', null, appMessages.pl)).toBe('Wszyscy');
    expect(knowledgeAccessLabel('level', 4, appMessages.pl)).toBe('Próg 4+');
    expect(knowledgeAccessLabel('excluded', null, appMessages.pl)).toBe('Nie w odpowiedziach');

    expect(knowledgeAccessLabel('public', null, appMessages.en)).toBe('Everyone');
    expect(knowledgeAccessLabel('approved', null, appMessages.en)).toBe('Everyone');
    expect(knowledgeAccessLabel('level', 4, appMessages.en)).toBe('Tier 4+');
    expect(knowledgeAccessLabel('excluded', null, appMessages.en)).toBe('Not in answers');
  });
});

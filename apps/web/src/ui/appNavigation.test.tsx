import { describe, expect, it } from 'vitest';

import { appMessages } from '@fa/i18n';

import { appNavigationGroups } from './appNavigation.js';

function labelsFor(role: 'user' | 'admin'): string[] {
  return appNavigationGroups({
    messages: appMessages.en,
    role,
    activeRoute: 'chat',
  }).flatMap((group) => group.items.map((item) => item.label));
}

describe('appNavigationGroups', () => {
  it('does not show Usage to regular users', () => {
    expect(labelsFor('user')).toEqual(['Chat']);
  });

  it('shows Usage to admins', () => {
    expect(labelsFor('admin')).toContain('Usage');
  });

  it('shows Settings only for admins', () => {
    expect(labelsFor('admin')).toContain('Settings');
    expect(labelsFor('user')).not.toContain('Settings');
  });
});

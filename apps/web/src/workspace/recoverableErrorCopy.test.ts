import { describe, expect, it } from 'vitest';

import { normalizeRecoverableErrorCopy } from './recoverableErrorCopy.js';

describe('normalizeRecoverableErrorCopy', () => {
  it('hides raw gateway failure copy behind a friendly recovery message', () => {
    expect(normalizeRecoverableErrorCopy('API request failed with status 502.')).toBe(
      'Connection interrupted. Check your network and try again.'
    );
  });

  it('hides fetch failure copy behind a friendly recovery message', () => {
    expect(normalizeRecoverableErrorCopy('Failed to fetch')).toBe(
      'Connection interrupted. Check your network and try again.'
    );
  });

  it('keeps specific non-network provider failures visible', () => {
    expect(normalizeRecoverableErrorCopy('Provider paused.')).toBe('Provider paused.');
  });
});

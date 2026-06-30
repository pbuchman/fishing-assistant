import { describe, expect, it } from 'vitest';

import { fixedClock, systemClock, toIsoString } from './time.js';

describe('time utilities', () => {
  it('returns Date values from the system clock', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  it('returns the same instant from a fixed clock', () => {
    const instant = new Date('2026-06-13T12:34:56.789Z');
    const clock = fixedClock(instant);

    expect(clock.now()).toEqual(instant);
    expect(clock.now()).toEqual(instant);
  });

  it('formats dates as ISO strings', () => {
    expect(toIsoString(new Date('2026-06-13T12:34:56.789Z'))).toBe('2026-06-13T12:34:56.789Z');
  });
});

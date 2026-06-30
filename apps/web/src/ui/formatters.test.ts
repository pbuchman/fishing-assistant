import { describe, expect, it } from 'vitest';

import {
  formatCompactIntegerPl,
  formatCostUsd,
  formatDateTimePl,
  formatInteger,
  formatIntegerPl,
  formatTokens,
} from './formatters.js';

describe('formatters', () => {
  it('formats dates numbers tokens and costs for Polish UI', () => {
    expect(formatDateTimePl('2026-06-19T15:07:00.000Z')).toMatch(
      /19\.06\.2026,? 17:07|19\.06\.2026,? 15:07/
    );
    expect(formatIntegerPl(1100)).toBe('1 100');
    expect(formatIntegerPl(2076088)).toBe('2 076 088');
    expect(formatCompactIntegerPl(2076088)).toMatch(/2,1 mln|2,1M|2,1 mln\./);
    expect(formatTokens(2076088, { compact: true })).toMatch(/2,1 mln|2,1M|2,1 mln\./);
    expect(formatTokens(2076088)).toBe('2 076 088');
    expect(formatInteger(2076088, 'en')).toBe('2,076,088');
    expect(formatTokens(2076088, { compact: true, locale: 'en' })).toBe('2.1M');
    expect(formatTokens(2076088, { locale: 'en' })).toBe('2,076,088');
    expect(formatCostUsd(12.345678)).toBe('$12.345678');
    expect(formatCostUsd(0.0024, { compact: true })).toBe('$0.0024');
    expect(formatCostUsd(0.000004, { compact: true })).toBe('<$0.0001');
  });
});

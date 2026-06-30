import { describe, expect, it } from 'vitest';

import { buildUsageEvent, FakeUsageSink, HttpInternalAuthUsageSink } from '@fa/llm-pricing';
import type { UsageSink } from '@fa/llm-pricing';

describe('@fa/llm-pricing exports', () => {
  it('exports the Phase 3 usage sink primitives', () => {
    expect(buildUsageEvent).toEqual(expect.any(Function));
    expect(HttpInternalAuthUsageSink).toEqual(expect.any(Function));
    expect(FakeUsageSink).toEqual(expect.any(Function));
  });

  it('keeps UsageSink nominal so inline no-op sinks cannot type-check', () => {
    // @ts-expect-error UsageSink is intentionally private-branded.
    const invalidSink: UsageSink = {
      record: () => Promise.resolve(),
      flush: () => Promise.resolve(),
    };

    expect(invalidSink).toBeDefined();
  });
});

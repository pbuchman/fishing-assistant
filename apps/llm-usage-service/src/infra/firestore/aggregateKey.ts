import { createHash } from 'node:crypto';

import type { LlmUsageEvent } from '../../domain/models/usageEvent.js';

function hashPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function eventDay(event: Pick<LlmUsageEvent, 'createdAt'>): string {
  return event.createdAt.slice(0, 10);
}

export function eventHour(event: Pick<LlmUsageEvent, 'createdAt'>): string {
  return event.createdAt.slice(0, 13);
}

export function computeAggregateId(event: LlmUsageEvent): string {
  return [
    eventDay(event),
    eventHour(event),
    event.owner.type,
    hashPart(event.owner.id),
    event.source.service,
    hashPart(event.source.component),
    event.source.operation,
    hashPart(event.source.promptType),
    event.request.provider,
    hashPart(event.request.model),
    hashPart(event.request.promptVersion),
  ].join('__');
}

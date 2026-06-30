export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(date: Date): Clock {
  const timestamp = date.getTime();

  return {
    now: () => new Date(timestamp),
  };
}

export function toIsoString(date: Date): string {
  return date.toISOString();
}

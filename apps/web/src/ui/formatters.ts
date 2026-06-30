const spacingPattern = /[\u00a0\u202f]/g;

const plDateTimeFormatter = new Intl.DateTimeFormat('pl-PL', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const plDateFormatter = new Intl.DateTimeFormat('pl-PL', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const enDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const enDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const plIntegerFormatter = new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 0,
  useGrouping: true,
});
const enIntegerFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

const plCompactFormatter = new Intl.NumberFormat('pl-PL', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const enCompactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function normalizeSpacing(value: string): string {
  return value.replace(spacingPattern, ' ');
}

export function formatDateTimePl(value: string): string {
  if (value.length === 0) {
    return '-';
  }

  return normalizeSpacing(plDateTimeFormatter.format(new Date(value)));
}

export function formatDateTime(value: string, locale = 'pl'): string {
  if (value.length === 0) {
    return '-';
  }

  const formatter = locale === 'en' ? enDateTimeFormatter : plDateTimeFormatter;
  return normalizeSpacing(formatter.format(new Date(value)));
}

export function formatDate(value: string, locale = 'pl'): string {
  if (value.length === 0) {
    return '-';
  }

  const formatter = locale === 'en' ? enDateFormatter : plDateFormatter;
  return normalizeSpacing(formatter.format(new Date(value)));
}

export function formatIntegerPl(value: number): string {
  return normalizeSpacing(plIntegerFormatter.format(value));
}

export function formatCompactIntegerPl(value: number): string {
  return normalizeSpacing(plCompactFormatter.format(value));
}

function integerFormatter(locale: string): Intl.NumberFormat {
  return locale === 'en' ? enIntegerFormatter : plIntegerFormatter;
}

function compactIntegerFormatter(locale: string): Intl.NumberFormat {
  return locale === 'en' ? enCompactFormatter : plCompactFormatter;
}

export function formatInteger(value: number, locale = 'pl'): string {
  return normalizeSpacing(integerFormatter(locale).format(value));
}

export function formatCompactInteger(value: number, locale = 'pl'): string {
  return normalizeSpacing(compactIntegerFormatter(locale).format(value));
}

export function formatTokens(
  value: number,
  options: { compact?: boolean; locale?: string } = {}
): string {
  const locale = options.locale ?? 'pl';
  return options.compact === true
    ? formatCompactInteger(value, locale)
    : formatInteger(value, locale);
}

export function formatCostUsd(value: number, options: { compact?: boolean } = {}): string {
  if (options.compact === true && value > 0 && value < 0.0001) {
    return '<$0.0001';
  }

  if (options.compact === true) {
    return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
  }

  return `$${value.toFixed(6)}`;
}

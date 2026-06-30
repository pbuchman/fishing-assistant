const sensitiveKeyPattern =
  /(authorization|internal[_-]?auth|api[_-]?key|private[_-]?key|key[_-]?file|token|secret|credentials|service[_-]?account|gcp[_-]?admin[_-]?key[_-]?file)/i;

/**
 * @param {unknown} value
 * @param {WeakSet<object>} seen
 * @returns {unknown}
 */
function redactValue(value, seen) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    try {
      return value.map((item) => redactValue(item, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);
  try {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveKeyPattern.test(key) ? '[REDACTED]' : redactValue(nested, seen),
      ])
    );
  } finally {
    seen.delete(value);
  }
}

/**
 * @param {unknown} payload
 * @returns {unknown}
 */
export function redactPayload(payload) {
  return redactValue(payload, new WeakSet());
}

import { timingSafeEqual } from 'node:crypto';

/**
 * @param {string | string[] | undefined} value
 * @returns {string}
 */
function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {string} expectedSecret
 * @returns {boolean}
 */
export function isValidAlertSecret(headers, expectedSecret) {
  const provided = firstHeaderValue(headers['x-fa-alert-secret']);
  if (provided.length === 0 || expectedSecret.length === 0) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expectedSecret);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * @typedef {{ issueNumber: number, issueUrl?: string, lastActiveAt: number }} AlertRecord
 */

/**
 * @param {{ dedupeWindowMs?: number }} [options]
 * @returns {{
 *   get(fingerprint: string): AlertRecord | undefined;
 *   rememberActive(fingerprint: string, issue: { number: number; html_url?: string }, now?: number): void;
 *   rememberDuplicate(fingerprint: string, now?: number): void;
 *   shouldCreateActive(fingerprint: string, now?: number): boolean;
 * }}
 */
export function createDedupeStore(options = {}) {
  const dedupeWindowMs = options.dedupeWindowMs ?? 15 * 60 * 1000;
  /** @type {Map<string, AlertRecord>} */
  const records = new Map();

  return {
    get(fingerprint) {
      return records.get(fingerprint);
    },

    rememberActive(fingerprint, issue, now = Date.now()) {
      /** @type {AlertRecord} */
      const record = {
        issueNumber: issue.number,
        lastActiveAt: now,
      };

      if (issue.html_url !== undefined) {
        record.issueUrl = issue.html_url;
      }

      records.set(fingerprint, record);
    },

    rememberDuplicate(fingerprint, now = Date.now()) {
      const existing = records.get(fingerprint);
      if (existing !== undefined) {
        existing.lastActiveAt = now;
      }
    },

    shouldCreateActive(fingerprint, now = Date.now()) {
      const existing = records.get(fingerprint);
      return existing === undefined || now - existing.lastActiveAt > dedupeWindowMs;
    },
  };
}

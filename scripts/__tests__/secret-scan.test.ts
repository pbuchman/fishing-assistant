import { describe, expect, it } from 'vitest';

import { scanText, scanTrackedFiles, shouldSkipPath } from '../secret-scan.mjs';

describe('secret scan', () => {
  const openAiKey = ['sk-proj', 'abcdefghijklmnopqrstuvwxyzABCDEF1234567890'].join('-');
  const longToken = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEF1234567890'].join('');

  it('scans committed env templates while allowing documented placeholders', () => {
    expect(shouldSkipPath('.env.example')).toBe(false);
    expect(
      scanText(
        '.env.example',
        [
          'FA_INTERNAL_AUTH_TOKEN=replace-with-local-generated-token',
          'FA_OPENAI_APP_API_KEY=',
          'FA_GCP_ADMIN_KEY_FILE=$HOME/.config/gcloud/fa-admin-key.json',
        ].join('\n')
      )
    ).toEqual([]);
  });

  it('detects real provider keys pasted into committed env templates', () => {
    expect(scanText('.env.example', `FA_OPENAI_APP_API_KEY=${openAiKey}`)).toEqual([
      { path: '.env.example', lineNumber: 1, patternName: 'openai-api-key' },
      { path: '.env.example', lineNumber: 1, patternName: 'long-secret-assignment' },
    ]);
  });

  it('detects JSON-style long secret assignments without printing values', () => {
    expect(
      scanText('config/example.json', JSON.stringify({ FA_INTERNAL_AUTH_TOKEN: longToken }))
    ).toEqual([
      { path: 'config/example.json', lineNumber: 1, patternName: 'long-secret-assignment' },
    ]);
  });

  it('continues to skip lockfiles and binary-like fixture paths', () => {
    expect(shouldSkipPath('pnpm-lock.yaml')).toBe(true);
    expect(shouldSkipPath('tests/fixtures/sample.env')).toBe(true);
    expect(shouldSkipPath('docs/image.png')).toBe(true);
  });

  it('skips tracked paths that no longer exist in the working tree', () => {
    expect(scanTrackedFiles(['docs/deleted-example.md'])).toEqual({
      findings: [],
      scannedFiles: 0,
    });
  });
});

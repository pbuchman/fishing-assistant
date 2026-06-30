import { describe, expect, it } from 'vitest';

import { config } from './config.js';
import { WEB_SERVICE_URLS } from './config.generated.js';

const backendOnlyNeedles = [
  'FA_AUTH0_ISSUER',
  'FA_AUTH0_JWKS_URI',
  'FA_BOOTSTRAP_ADMIN_EMAILS',
  'FA_USER_SERVICE_INTERNAL_URL',
  'FA_INTERNAL_AUTH_TOKEN',
  'FA_INTERNAL_AUTH_TOKEN_PREVIOUS',
  'localhost',
  '127.0.0.1',
] as const;

describe('web runtime config', () => {
  it('exposes user-service through the same-origin service manifest URL', () => {
    expect(WEB_SERVICE_URLS.USER_SERVICE).toBe('/api/users');
    expect(config.services.USER_SERVICE).toBe('/api/users');
  });

  it('exposes only browser-safe Auth0 values', () => {
    expect(config.auth0).toEqual({
      domain: import.meta.env.FA_AUTH0_DOMAIN,
      clientId: import.meta.env.FA_AUTH0_CLIENT_ID,
      audience: import.meta.env.FA_AUTH0_AUDIENCE,
    });
  });

  it('keeps backend-only auth and internal values out of browser config', () => {
    const serializedConfig = JSON.stringify({
      auth0: config.auth0,
      services: config.services,
    });
    const serializedGeneratedUrls = JSON.stringify(WEB_SERVICE_URLS);

    for (const needle of backendOnlyNeedles) {
      expect(serializedConfig).not.toContain(needle);
      expect(serializedGeneratedUrls).not.toContain(needle);
    }
  });
});

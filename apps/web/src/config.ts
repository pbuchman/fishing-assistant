import { WEB_SERVICE_URLS } from './config.generated.js';

declare global {
  interface ImportMetaEnv {
    readonly FA_ENVIRONMENT?: string;
    readonly FA_PUBLIC_ORIGIN?: string;
    readonly FA_AUTH0_DOMAIN?: string;
    readonly FA_AUTH0_CLIENT_ID?: string;
    readonly FA_AUTH0_AUDIENCE?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export const config = {
  environment: import.meta.env.FA_ENVIRONMENT ?? 'dev',
  publicOrigin: import.meta.env.FA_PUBLIC_ORIGIN ?? window.location.origin,
  services: WEB_SERVICE_URLS,
  auth0: {
    domain: import.meta.env.FA_AUTH0_DOMAIN,
    clientId: import.meta.env.FA_AUTH0_CLIENT_ID,
    audience: import.meta.env.FA_AUTH0_AUDIENCE,
  },
};

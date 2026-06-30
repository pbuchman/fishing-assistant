import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';

interface ServiceManifestEntry {
  name: string;
  envSuffix: string;
  apiPath: string;
  proxyTarget: string;
  serviceUrl: string;
}

interface ServiceManifest {
  services: ServiceManifestEntry[];
}

const configDir = dirname(fileURLToPath(import.meta.url));
const apiPathPattern = /^\/api\/[a-z0-9-]+$/;
const urlPattern = /^https?:\/\/\S+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isServiceManifestEntry(value: unknown): value is ServiceManifestEntry {
  return (
    isRecord(value) &&
    typeof value['name'] === 'string' &&
    typeof value['envSuffix'] === 'string' &&
    typeof value['apiPath'] === 'string' &&
    apiPathPattern.test(value['apiPath']) &&
    typeof value['proxyTarget'] === 'string' &&
    urlPattern.test(value['proxyTarget']) &&
    typeof value['serviceUrl'] === 'string'
  );
}

function readServiceManifest(): ServiceManifest {
  const parsed = JSON.parse(
    readFileSync(resolve(configDir, 'service-manifest.json'), 'utf8')
  ) as unknown;

  if (!isRecord(parsed) || !Array.isArray(parsed['services'])) {
    throw new Error('service-manifest.json must have a services array');
  }

  const services: ServiceManifestEntry[] = [];
  for (const [index, service] of parsed['services'].entries()) {
    if (!isServiceManifestEntry(service)) {
      throw new Error(`Invalid service-manifest.json services[${String(index)}]`);
    }
    services.push(service);
  }

  return { services };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripApiPrefix(path: string, apiPath: string): string {
  const stripped = path.replace(new RegExp(`^${escapeRegExp(apiPath)}(?=/|$)`), '');
  return stripped === '' ? '/' : stripped;
}

function pathnameFromProxyUrl(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

function isPublicInternalApiPath(path: string, apiPath: string): boolean {
  return new RegExp(`^${escapeRegExp(apiPath)}/internal(?:/|$)`).test(pathnameFromProxyUrl(path));
}

export function createApiProxy(
  services: ServiceManifestEntry[]
): Record<string, string | ProxyOptions> {
  return Object.fromEntries(
    services.map((service) => [
      service.apiPath,
      {
        target: service.proxyTarget,
        changeOrigin: true,
        bypass: (request) =>
          isPublicInternalApiPath(request.url ?? '', service.apiPath) ? false : undefined,
        rewrite: (path: string) => stripApiPrefix(path, service.apiPath),
      },
    ])
  );
}

const manifest = readServiceManifest();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: 'FA_',
  envDir: false,
  server: {
    allowedHosts: ['dev.fishing-assistant.online'],
    proxy: createApiProxy(manifest.services),
  },
  resolve: {
    alias: {
      '@': resolve(configDir, 'src'),
    },
  },
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  generateServiceWiring,
  loadServiceManifest,
  renderConfigGenerated,
  renderTerraformServiceUrls,
  writeServiceWiringArtifacts,
} from '../generate-service-wiring.mjs';

const chatService = {
  name: 'chat-service',
  envSuffix: 'CHAT_SERVICE',
  apiPath: '/api/chat',
  proxyTarget: 'http://localhost:3201',
  serviceUrl: 'http://localhost:3201',
};

const knowledgeService = {
  name: 'knowledge-service',
  envSuffix: 'KNOWLEDGE_SERVICE',
  apiPath: '/api/knowledge',
  proxyTarget: 'http://localhost:3202',
  serviceUrl: 'http://localhost:3202',
};

const llmUsageService = {
  name: 'llm-usage-service',
  envSuffix: 'LLM_USAGE_SERVICE',
  apiPath: '/api/llm-usage',
  proxyTarget: 'http://localhost:3203',
  serviceUrl: 'http://localhost:3203',
};

const userService = {
  name: 'user-service',
  envSuffix: 'USER_SERVICE',
  apiPath: '/api/users',
  proxyTarget: 'http://localhost:3204',
  serviceUrl: 'http://localhost:3204',
};

const baseManifest = {
  description: 'test manifest',
  services: [chatService, knowledgeService],
};

const fullManifest = {
  description: 'test manifest',
  services: [chatService, knowledgeService, llmUsageService, userService],
};

function withManifest<T>(manifest: unknown, run: (manifestPath: string, root: string) => T): T {
  const root = mkdtempSync(path.join(tmpdir(), 'fa-service-wiring-'));
  const manifestDirectory = path.join(root, 'apps/web');
  const manifestPath = path.join(manifestDirectory, 'service-manifest.json');

  try {
    mkdirSync(manifestDirectory, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return run(manifestPath, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('service wiring generator', () => {
  it('requires the checked-in manifest to include user-service on /api/users', () => {
    const manifestPath = fileURLToPath(
      new URL('../../apps/web/service-manifest.json', import.meta.url)
    );
    const manifest = loadServiceManifest(manifestPath);

    expect(manifest.services).toEqual(expect.arrayContaining([userService]));
  });

  it('rejects duplicate service names, env suffixes, and api paths', () => {
    const duplicateCases = [
      {
        field: 'service name',
        service: { ...knowledgeService, name: 'chat-service' },
        expected: 'Duplicate service name in manifest: chat-service',
      },
      {
        field: 'envSuffix',
        service: { ...knowledgeService, envSuffix: 'CHAT_SERVICE' },
        expected: 'Duplicate envSuffix in manifest: CHAT_SERVICE',
      },
      {
        field: 'apiPath',
        service: { ...knowledgeService, apiPath: '/api/chat' },
        expected: 'Duplicate apiPath in manifest: /api/chat',
      },
    ];

    for (const testCase of duplicateCases) {
      withManifest(
        {
          ...baseManifest,
          services: [chatService, testCase.service],
        },
        (manifestPath) => {
          expect(() => loadServiceManifest(manifestPath), testCase.field).toThrow(
            testCase.expected
          );
        }
      );
    }
  });

  it('generates web config with same-origin /api paths and no localhost URLs', () => {
    const wiring = generateServiceWiring(fullManifest);
    const generatedConfig = renderConfigGenerated(wiring);

    expect(generatedConfig).toContain("CHAT_SERVICE: '/api/chat'");
    expect(generatedConfig).toContain("KNOWLEDGE_SERVICE: '/api/knowledge'");
    expect(generatedConfig).toContain("LLM_USAGE_SERVICE: '/api/llm-usage'");
    expect(generatedConfig).toContain("USER_SERVICE: '/api/users'");
    expect(generatedConfig).not.toContain('localhost');
    expect(generatedConfig).not.toContain('127.0.0.1');
    expect(generatedConfig).not.toContain('FA_AUTH0_ISSUER');
    expect(generatedConfig).not.toContain('FA_AUTH0_JWKS_URI');
    expect(generatedConfig).not.toContain('FA_BOOTSTRAP_ADMIN_EMAILS');
    expect(generatedConfig).not.toContain('FA_INTERNAL_AUTH_TOKEN');
    expect(generatedConfig).not.toContain('FA_INTERNAL_AUTH_TOKEN_PREVIOUS');
  });

  it('generates terraform service URLs with FA env names and same-origin paths', () => {
    const wiring = generateServiceWiring(fullManifest);
    const terraformOutput = JSON.parse(renderTerraformServiceUrls(wiring)) as {
      service_urls: Record<string, string>;
    };

    expect(terraformOutput.service_urls).toEqual({
      FA_CHAT_SERVICE_URL: '/api/chat',
      FA_KNOWLEDGE_SERVICE_URL: '/api/knowledge',
      FA_LLM_USAGE_SERVICE_URL: '/api/llm-usage',
      FA_USER_SERVICE_URL: '/api/users',
    });
  });

  it('writes deterministic generated artifacts', () => {
    withManifest(baseManifest, (manifestPath, root) => {
      const manifest = loadServiceManifest(manifestPath);
      const firstWiring = generateServiceWiring(manifest);
      const firstOutputs = writeServiceWiringArtifacts(root, firstWiring);
      const firstContents = firstOutputs.map((output) => readFileSync(output.path, 'utf8'));

      const secondWiring = generateServiceWiring(manifest);
      const secondOutputs = writeServiceWiringArtifacts(root, secondWiring);
      const secondContents = secondOutputs.map((output) => readFileSync(output.path, 'utf8'));

      expect(secondOutputs.map((output) => output.path)).toEqual(
        firstOutputs.map((output) => output.path)
      );
      expect(secondContents).toEqual(firstContents);
    });
  });
});

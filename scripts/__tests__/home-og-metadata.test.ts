import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readHomeIndexHtml(): string {
  return readFileSync(resolve(process.cwd(), 'apps/web/index.html'), 'utf8');
}

describe('homepage open graph metadata', () => {
  it('renders product-only metadata and avoids chat or conversation routes', () => {
    const html = readHomeIndexHtml().replace(/\s+/g, ' ');
    const ogImagePath = resolve(process.cwd(), 'apps/web/public/og/fishing-assistant.png');
    const publicOriginPlaceholder = '%FA_PUBLIC_ORIGIN%';

    expect(html).toContain('name="description"');
    expect(html).toContain(
      'content="Asystent wedkarski do planowania sesji, doboru zestawow i pracy z Baza Wiedzy."'
    );
    expect(html).toContain(`rel="canonical" href="${publicOriginPlaceholder}/"`);
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('property="og:site_name" content="Fishing Assistant"');
    expect(html).toContain('property="og:title" content="Fishing Assistant"');
    expect(html).toContain(
      'property="og:description" content="Asystent wedkarski do planowania sesji, doboru zestawow i pracy z Baza Wiedzy."'
    );
    expect(html).toContain(`property="og:url" content="${publicOriginPlaceholder}/"`);
    expect(html).toContain(
      `property="og:image" content="${publicOriginPlaceholder}/og/fishing-assistant.png"`
    );
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:title" content="Fishing Assistant"');
    expect(html).toContain(
      'name="twitter:description" content="Asystent wedkarski do planowania sesji, doboru zestawow i pracy z Baza Wiedzy."'
    );
    expect(html).toContain(
      `name="twitter:image" content="${publicOriginPlaceholder}/og/fishing-assistant.png"`
    );
    expect(html).not.toContain('https://fishing-assistant.online/');
    expect(existsSync(ogImagePath)).toBe(true);
    expect(html).not.toMatch(
      /\/app#\/chat|conversationId|conversation\/|answer-content|\/app#\/admin/i
    );
  });
});

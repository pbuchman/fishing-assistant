import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('web light theme policy', () => {
  it('advertises only light color scheme in the document shell', () => {
    const html = readRepoFile('apps/web/index.html').replace(/\s+/g, ' ');
    const colorSchemeMetaTags = html.match(/<meta name="color-scheme"[^>]*>/g) ?? [];
    const themeColorMetaTags = html.match(/<meta name="theme-color"[^>]*>/g) ?? [];

    expect(html).toContain('<html lang="en" data-color-mode="light">');
    expect(colorSchemeMetaTags).toEqual(['<meta name="color-scheme" content="only light" />']);
    expect(themeColorMetaTags).toEqual(['<meta name="theme-color" content="#f4f7fb" />']);
    expect(html).not.toContain('prefers-color-scheme');
    expect(html).not.toContain('#050506');
  });

  it('prevents CSS from reacting to device dark-mode preference', () => {
    const styles = readRepoFile('apps/web/src/styles.css');

    expect(styles).toContain('color-scheme: only light;');
    expect(styles).not.toContain('color-scheme: light dark;');
    expect(styles).not.toContain('@media (prefers-color-scheme: dark)');
    expect(styles).not.toMatch(/--fa-[a-z-]*dark/);
  });

  it('exports only light-mode theme tokens', () => {
    const theme = readRepoFile('apps/web/src/ui/theme.ts');

    expect(theme).not.toMatch(/--fa-[a-z-]*dark/);
  });
});

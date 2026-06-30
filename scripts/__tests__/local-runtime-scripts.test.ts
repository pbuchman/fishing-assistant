import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const localPm2Wrapper = readFileSync('scripts/local-pm2.sh', 'utf8');

describe('local runtime package scripts', () => {
  it('exposes an explicit command for pulling ignored local env from approved sources', () => {
    expect(packageJson.scripts['local:env:pull']).toBe('node scripts/pull-local-env.mjs');
  });

  it('prepares generated config before starting the self-refreshing local PM2 runtime', () => {
    const devScript = packageJson.scripts['dev'];

    expect(devScript).toContain('node scripts/dev-setup.mjs');
    expect(devScript).toContain('pnpm run generate:service-wiring');
    expect(devScript).toContain('scripts/local-pm2.sh start ecosystem.local.config.cjs');
    expect(devScript).not.toContain('pnpm run build:web');
  });

  it('runs local PM2 commands through direnv so ignored FA env files are loaded', () => {
    for (const scriptName of ['dev', 'services:start', 'services:restart']) {
      expect(packageJson.scripts[scriptName]).toContain('scripts/local-pm2.sh');
      expect(packageJson.scripts[scriptName]).toContain('ecosystem.local.config.cjs');
    }
  });

  it('isolates local PM2 from the DEV deploy PM2 home', () => {
    for (const scriptName of [
      'dev',
      'services:start',
      'services:stop',
      'services:delete',
      'services:logs',
      'services:status',
      'services:restart',
    ]) {
      expect(packageJson.scripts[scriptName]).toContain('scripts/local-pm2.sh');
    }
  });

  it('overrides PM2 home after direnv loads ignored local env files', () => {
    expect(localPm2Wrapper).toContain('direnv exec . env');
    expect(localPm2Wrapper).toContain('FA_PM2_HOME="${local_pm2_home}"');
    expect(localPm2Wrapper).toContain('PM2_HOME="${local_pm2_home}"');
  });

  it('cleans fixed local FA ports before starting and after stopping services', () => {
    for (const scriptName of ['dev', 'services:start', 'services:restart']) {
      const script = packageJson.scripts[scriptName] ?? '';

      expect(script).toContain('node scripts/local-runtime-cleanup.mjs');
      expect(script.indexOf('node scripts/local-runtime-cleanup.mjs')).toBeLessThan(
        script.indexOf('scripts/local-pm2.sh')
      );
    }

    for (const scriptName of ['services:stop', 'services:delete']) {
      const script = packageJson.scripts[scriptName] ?? '';

      expect(script).toContain('node scripts/local-runtime-cleanup.mjs');
      expect(script.indexOf('scripts/local-pm2.sh')).toBeLessThan(
        script.indexOf('node scripts/local-runtime-cleanup.mjs')
      );
    }
  });
});

describe('local runtime cleanup helper', () => {
  it('targets only the fixed localhost ports used by the FA local runtime', async () => {
    const cleanup = await import('../local-runtime-cleanup.mjs');

    expect(cleanup.LOCAL_FA_PORTS).toEqual([3100, 3201, 3202, 3203, 3204]);
  });

  it('classifies only FA local runtime processes as managed cleanup targets', async () => {
    const cleanup = await import('../local-runtime-cleanup.mjs');

    expect(
      cleanup.isFaLocalRuntimeCommand(
        '/tmp/fa-worktrees/fishing-assistant-2/node_modules/tsx/dist/cli.mjs'
      )
    ).toBe(true);
    expect(
      cleanup.isFaLocalRuntimeCommand(
        '/tmp/fa-worktrees/fishing-assistant-1/scripts/run-web-vite.mjs'
      )
    ).toBe(true);
    expect(cleanup.isFaLocalRuntimeCommand('/usr/local/bin/postgres -D /tmp/db')).toBe(false);
  });

  it('extracts FA PM2 daemon pids from process listings for colliding worktrees', async () => {
    const cleanup = await import('../local-runtime-cleanup.mjs');

    expect(
      cleanup.findFaPm2DaemonPids(`  PID  PPID  PGID COMMAND
89683     1 89683 PM2 v6.0.14: God Daemon (/tmp/fa-worktrees/fishing-assistant-2/.cache/pm2-local)
90100     1 90100 PM2 v6.0.14: God Daemon (/tmp/unrelated-pm2)
`)
    ).toEqual([89683]);
  });
});

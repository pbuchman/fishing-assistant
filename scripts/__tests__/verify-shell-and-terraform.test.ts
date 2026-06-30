import { describe, expect, it } from 'vitest';

import { filterTrackedShellScripts, verifyShellScripts } from '../verify-shell.mjs';
import { verifyTerraform } from '../verify-terraform.mjs';

interface CommandCall {
  command: string;
  args: string[];
  cwd: string;
}

describe('shell verifier', () => {
  it('filters tracked shell scripts under scripts', () => {
    expect(
      filterTrackedShellScripts([
        'docs/deploy.sh',
        'scripts/deploy/deploy-dev.sh',
        'scripts/hetzner/provision.sh',
        'scripts/verify-env.mjs',
        'scripts/template.sh.tftpl',
      ])
    ).toEqual(['scripts/deploy/deploy-dev.sh', 'scripts/hetzner/provision.sh']);
  });

  it('runs bash syntax checks and skips shellcheck when unavailable', () => {
    const calls: CommandCall[] = [];
    const output: string[] = [];

    const result = verifyShellScripts('/repo', {
      trackedFiles: ['scripts/a.sh', 'scripts/nested/b.sh'],
      commandExists: (command) => command === 'bash',
      runCommand: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { status: 0 };
      },
      write: (message) => output.push(message),
    });

    expect(result).toEqual({ checkedFiles: 2, shellcheck: 'skipped' });
    expect(calls).toEqual([
      { command: 'bash', args: ['-n', 'scripts/a.sh'], cwd: '/repo' },
      { command: 'bash', args: ['-n', 'scripts/nested/b.sh'], cwd: '/repo' },
    ]);
    expect(output.join('')).toContain('shellcheck not found; skipping shellcheck.');
  });

  it('runs shellcheck after syntax checks when installed', () => {
    const calls: CommandCall[] = [];

    const result = verifyShellScripts('/repo', {
      trackedFiles: ['scripts/a.sh', 'scripts/nested/b.sh'],
      commandExists: (command) => command === 'bash' || command === 'shellcheck',
      runCommand: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { status: 0 };
      },
      write: () => undefined,
    });

    expect(result).toEqual({ checkedFiles: 2, shellcheck: 'passed' });
    expect(calls).toEqual([
      { command: 'bash', args: ['-n', 'scripts/a.sh'], cwd: '/repo' },
      { command: 'bash', args: ['-n', 'scripts/nested/b.sh'], cwd: '/repo' },
      { command: 'shellcheck', args: ['scripts/a.sh', 'scripts/nested/b.sh'], cwd: '/repo' },
    ]);
  });

  it('fails clearly when bash syntax checks fail', () => {
    expect(() =>
      verifyShellScripts('/repo', {
        trackedFiles: ['scripts/bad.sh'],
        commandExists: (command) => command === 'bash',
        runCommand: () => ({ status: 2 }),
        write: () => undefined,
      })
    ).toThrow('Shell syntax check failed for scripts/bad.sh');
  });
});

describe('terraform verifier', () => {
  it('fails clearly when terraform is missing', () => {
    expect(() =>
      verifyTerraform('/repo', {
        commandExists: () => false,
        runCommand: () => {
          throw new Error('unexpected command');
        },
      })
    ).toThrow('terraform is not installed or not on PATH');
  });

  it('runs terraform format, init, and validate checks in order', () => {
    const calls: CommandCall[] = [];

    const result = verifyTerraform('/repo', {
      commandExists: (command) => command === 'terraform',
      runCommand: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { status: 0 };
      },
    });

    expect(result).toEqual({
      rootsValidated: ['terraform/gcp-data-plane', 'terraform/hetzner-prod'],
    });
    expect(calls).toEqual([
      {
        command: 'terraform',
        args: ['fmt', '-check', '-recursive', 'terraform'],
        cwd: '/repo',
      },
      {
        command: 'terraform',
        args: ['-chdir=terraform/gcp-data-plane', 'init', '-backend=false'],
        cwd: '/repo',
      },
      {
        command: 'terraform',
        args: ['-chdir=terraform/gcp-data-plane', 'validate'],
        cwd: '/repo',
      },
      {
        command: 'terraform',
        args: ['-chdir=terraform/hetzner-prod', 'init', '-backend=false'],
        cwd: '/repo',
      },
      {
        command: 'terraform',
        args: ['-chdir=terraform/hetzner-prod', 'validate'],
        cwd: '/repo',
      },
    ]);
  });

  it('reports the failing terraform phase', () => {
    expect(() =>
      verifyTerraform('/repo', {
        commandExists: (command) => command === 'terraform',
        runCommand: (_command, args) => ({
          status: args.includes('validate') ? 1 : 0,
        }),
      })
    ).toThrow('Terraform verification failed during validate for terraform/gcp-data-plane');
  });
});

#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const terraformRoots = ['terraform/gcp-data-plane', 'terraform/hetzner-prod'];

/**
 * @typedef {{ cwd: string, stdio?: import('node:child_process').StdioOptions }} CommandOptions
 * @typedef {{ status: number | null, error?: Error }} CommandResult
 * @typedef {(command: string, args: string[], options: CommandOptions) => CommandResult} RunCommand
 * @typedef {(command: string) => boolean} CommandExists
 * @typedef {{
 *   runCommand?: RunCommand,
 *   commandExists?: CommandExists,
 * }} VerifyTerraformOptions
 * @typedef {{ rootsValidated: string[] }} VerifyTerraformResult
 */

/** @param {string} command */
function defaultCommandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.error === undefined;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {CommandOptions} options
 * @returns {CommandResult}
 */
function defaultRunCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error instanceof Error) {
    return { status: result.status, error: result.error };
  }

  return { status: result.status };
}

/**
 * @param {string} phase
 * @param {CommandResult} result
 */
function assertTerraformPhaseSucceeded(phase, result) {
  if (result.error instanceof Error) {
    throw new Error(`Terraform verification failed during ${phase}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Terraform verification failed during ${phase}`);
  }
}

/**
 * @param {string} root
 * @param {VerifyTerraformOptions} [options]
 * @returns {VerifyTerraformResult}
 */
function verifyTerraform(root, options = {}) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const commandExists = options.commandExists ?? defaultCommandExists;

  if (!commandExists('terraform')) {
    throw new Error('terraform is not installed or not on PATH.');
  }

  assertTerraformPhaseSucceeded(
    'fmt -check',
    runCommand('terraform', ['fmt', '-check', '-recursive', 'terraform'], {
      cwd: root,
      stdio: 'inherit',
    })
  );

  for (const terraformRoot of terraformRoots) {
    assertTerraformPhaseSucceeded(
      `init for ${terraformRoot}`,
      runCommand('terraform', [`-chdir=${terraformRoot}`, 'init', '-backend=false'], {
        cwd: root,
        stdio: 'inherit',
      })
    );
    assertTerraformPhaseSucceeded(
      `validate for ${terraformRoot}`,
      runCommand('terraform', [`-chdir=${terraformRoot}`, 'validate'], {
        cwd: root,
        stdio: 'inherit',
      })
    );
  }

  return { rootsValidated: [...terraformRoots] };
}

function main() {
  try {
    const result = verifyTerraform(repoRoot);
    process.stdout.write(`Terraform verified for ${result.rootsValidated.join(', ')}.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Terraform verification failed: ${message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main();
}

export { verifyTerraform };

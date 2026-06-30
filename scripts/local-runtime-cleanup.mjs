#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @typedef {{ pid: number; ppid: number; pgid: number; command: string }} ProcessInfo
 */

export const LOCAL_FA_PORTS = Object.freeze([3100, 3201, 3202, 3203, 3204]);

const SIGNAL_TIMEOUT_MS = 2000;
const FA_PATH_PATTERN = /fishing-assistant(?:-\d+)?\//u;

/**
 * @param {string} output
 * @returns {number[]}
 */
export function parsePids(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isFaLocalRuntimeCommand(command) {
  const normalized = command.replaceAll('\\', '/');

  if (!FA_PATH_PATTERN.test(normalized)) {
    return false;
  }

  return (
    normalized.includes('/node_modules/tsx/') ||
    normalized.includes('/node_modules/.pnpm/tsx@') ||
    normalized.includes('/scripts/run-web-vite.mjs') ||
    normalized.includes('/node_modules/vite/bin/vite') ||
    normalized.includes(' src/index.ts')
  );
}

/**
 * @param {string} psOutput
 * @returns {number[]}
 */
export function findFaPm2DaemonPids(psOutput) {
  const pids = [];

  for (const line of psOutput.split(/\r?\n/u)) {
    const match = line.match(/^\s*(\d+)\s+.*PM2\s+v[\s\S]*God Daemon\s+\(([^)]+)\)/u);
    if (!match) {
      continue;
    }

    const pm2Home = (match[2] ?? '').replaceAll('\\', '/');
    if (!FA_PATH_PATTERN.test(pm2Home) || !pm2Home.includes('/.cache/pm2-local')) {
      continue;
    }

    const pid = Number(match[1] ?? 0);
    if (Number.isInteger(pid) && pid > 0) {
      pids.push(pid);
    }
  }

  return pids;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
function execText(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/**
 * @param {number} port
 * @returns {number[]}
 */
function listenerPidsForPort(port) {
  return parsePids(execText('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN']));
}

/**
 * @param {number[]} pids
 * @returns {ProcessInfo[]}
 */
function processTableForPids(pids) {
  if (pids.length === 0) {
    return [];
  }

  const output = execText('ps', ['-o', 'pid=,ppid=,pgid=,command=', '-p', pids.join(',')]);
  /** @type {ProcessInfo[]} */
  const processes = [];

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\s\S]+)$/u);
    if (!match) {
      continue;
    }

    processes.push({
      pid: Number(match[1] ?? 0),
      ppid: Number(match[2] ?? 0),
      pgid: Number(match[3] ?? 0),
      command: match[4] ?? '',
    });
  }

  return processes;
}

/**
 * @param {number} pid
 * @returns {ProcessInfo | undefined}
 */
function processInfo(pid) {
  return processTableForPids([pid])[0];
}

/**
 * @param {number} pid
 * @returns {ProcessInfo[]}
 */
function ancestorInfos(pid) {
  /** @type {ProcessInfo[]} */
  const ancestors = [];
  const seen = new Set();
  let currentPid = pid;

  while (currentPid > 1 && !seen.has(currentPid)) {
    seen.add(currentPid);
    const info = processInfo(currentPid);
    if (!info) {
      break;
    }

    ancestors.push(info);
    currentPid = info.ppid;
  }

  return ancestors;
}

/**
 * @returns {string}
 */
function allProcessOutput() {
  return execText('ps', ['-axo', 'pid,ppid,pgid,command']);
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorCode(error) {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') {
      throw error;
    }
  }
}

/**
 * @param {number} pgid
 * @param {NodeJS.Signals} signal
 */
function killProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    const code = errorCode(error);
    if (code !== 'ESRCH' && code !== 'EINVAL') {
      throw error;
    }
  }
}

/**
 * @param {readonly number[]} ports
 * @returns {Promise<boolean>}
 */
async function waitUntilClear(ports) {
  const deadline = Date.now() + SIGNAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ports.every((port) => listenerPidsForPort(port).length === 0)) {
      return true;
    }
    await delay(100);
  }
  return ports.every((port) => listenerPidsForPort(port).length === 0);
}

/**
 * @param {{ ports?: readonly number[] }} [options]
 * @returns {Promise<{ cleaned: boolean; killedPids: number[]; ports: readonly number[] }>}
 */
export async function cleanupLocalRuntimePorts({ ports = LOCAL_FA_PORTS } = {}) {
  const listeners = ports.flatMap((port) =>
    listenerPidsForPort(port).map((pid) => ({ port, pid }))
  );

  if (listeners.length === 0) {
    return { cleaned: false, killedPids: [], ports };
  }

  const targetPids = new Set();
  const targetPgids = new Set();
  const blockedPorts = [];

  for (const listener of listeners) {
    const chain = ancestorInfos(listener.pid);
    const isManaged = chain.some((info) => isFaLocalRuntimeCommand(info.command));

    if (!isManaged) {
      blockedPorts.push(listener.port);
      continue;
    }

    for (const info of chain) {
      if (isFaLocalRuntimeCommand(info.command)) {
        targetPids.add(info.pid);
        targetPgids.add(info.pgid);
      }
    }
  }

  if (blockedPorts.length > 0) {
    throw new Error(
      `Refusing to kill non-FA listener on local FA port(s): ${[...new Set(blockedPorts)].join(
        ', '
      )}`
    );
  }

  const pm2DaemonPids = findFaPm2DaemonPids(allProcessOutput());
  for (const pid of pm2DaemonPids) {
    targetPids.add(pid);
  }

  for (const pid of targetPids) {
    killPid(pid, 'SIGTERM');
  }
  for (const pgid of targetPgids) {
    killProcessGroup(pgid, 'SIGTERM');
  }

  if (!(await waitUntilClear(ports))) {
    for (const pid of targetPids) {
      killPid(pid, 'SIGKILL');
    }
    for (const pgid of targetPgids) {
      killProcessGroup(pgid, 'SIGKILL');
    }
  }

  if (!(await waitUntilClear(ports))) {
    const remainingPorts = ports.filter((port) => listenerPidsForPort(port).length > 0);
    throw new Error(`Local FA port cleanup failed for port(s): ${remainingPorts.join(', ')}`);
  }

  return { cleaned: true, killedPids: [...targetPids].sort((a, b) => a - b), ports };
}

async function main() {
  const result = await cleanupLocalRuntimePorts();
  if (result.cleaned) {
    process.stdout.write(
      `Cleaned stale local FA listener(s) on port(s): ${result.ports.join(', ')}\n`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

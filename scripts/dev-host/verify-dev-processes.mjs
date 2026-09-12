import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{name: string, pid: number, pm2_env: {status: string, pm_cwd: string, watch: boolean}}} ManagedProcess */
/** @typedef {{cwdForPid: (pid: number) => string, parentForPid: (pid: number) => number, listeners: (port: number) => number[]}} Inspection */
const services = {
  'chat-service': 3201,
  'knowledge-service': 3202,
  'llm-usage-service': 3203,
  'user-service': 3204,
  web: 3100,
};

/** @param {ManagedProcess[]} processes @param {string} root @param {Inspection} inspection */
export function verifyProcesses(processes, root, inspection) {
  for (const [service, port] of Object.entries(services)) {
    const matches = processes.filter((entry) => entry.name === `fa-${service}`);
    const entry = matches[0];
    if (matches.length !== 1 || !entry) throw new Error(`Expected exactly one fa-${service}`);
    const cwd = resolve(root, 'apps', service);
    if (
      entry.pm2_env?.status !== 'online' ||
      entry.pid <= 0 ||
      entry.pm2_env.pm_cwd !== cwd ||
      inspection.cwdForPid(entry.pid) !== cwd ||
      entry.pm2_env.watch !== false
    ) {
      throw new Error(`Wrong process identity or configuration: fa-${service}`);
    }
    const listeners = inspection.listeners(port);
    if (listeners.length === 0) throw new Error(`No listener for fa-${service}`);
    for (const listener of listeners) {
      let pid = listener;
      const seen = new Set();
      while (pid > 1 && pid !== entry.pid && !seen.has(pid)) {
        seen.add(pid);
        pid = inspection.parentForPid(pid);
      }
      if (pid !== entry.pid) throw new Error(`Port ${port} belongs to a different process`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = realpathSync(process.argv[2] ?? '.');
  verifyProcesses(JSON.parse(readFileSync(0, 'utf8')), root, {
    cwdForPid: (pid) => realpathSync(`/proc/${pid}/cwd`),
    parentForPid: (pid) =>
      Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s+(\d+)/m)?.[1] ?? 0),
    listeners: (port) => {
      const result = spawnSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
      });
      if (result.error || (result.status !== 0 && result.status !== 1))
        throw new Error('Cannot inspect port ownership');
      return [...new Set(result.stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
    },
  });
  process.stdout.write('Verified five FA processes, checkout directories and port ownership\n');
}

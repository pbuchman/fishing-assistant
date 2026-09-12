import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyProcesses } from './verify-dev-processes.mjs';
const names = ['chat-service', 'knowledge-service', 'llm-usage-service', 'user-service', 'web'];
const ports = [3201, 3202, 3203, 3204, 3100];
const root = '/deploy/fa';
const processes = names.map((name, index) => ({
  name: `fa-${name}`,
  pid: index + 10,
  pm2_env: { status: 'online', pm_cwd: `${root}/apps/${name}`, watch: false },
}));
const inspection = {
  /** @param {number} pid */
  cwdForPid: (pid) => processes.find((entry) => entry.pid === pid)?.pm2_env.pm_cwd ?? '',
  /** @param {number} pid */
  parentForPid: (pid) => pid - 100,
  /** @param {number} port */
  listeners: (port) => [ports.indexOf(port) + 110],
};
test('requires all five FA processes and accepts their child listeners', () => {
  verifyProcesses(processes, root, inspection);
  assert.throws(
    () => verifyProcesses(processes.slice(0, 4), root, inspection),
    /exactly one fa-web/
  );
});
test('rejects old checkout, watched processes and unrelated healthy port listeners', () => {
  assert.throws(
    () => verifyProcesses(processes, root, { ...inspection, cwdForPid: () => '/deploy/fka' }),
    /identity/
  );
  assert.throws(
    () => verifyProcesses(processes, root, { ...inspection, listeners: () => [1] }),
    /different process/
  );
  const watched = structuredClone(processes);
  if (watched[0]) watched[0].pm2_env.watch = true;
  assert.throws(() => verifyProcesses(watched, root, inspection), /configuration/);
});

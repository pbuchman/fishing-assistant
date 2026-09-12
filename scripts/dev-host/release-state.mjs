import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [mode, sha, directory] = process.argv.slice(2);
if (!directory || !sha || !/^[a-f0-9]{40}$/.test(sha))
  throw new Error('Release SHA and state directory required');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== sha) throw new Error('Checkout does not match prepared SHA');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
  throw new Error('Deploy checkout has uncommitted changes');
}
const dist = resolve('apps/web/dist');
const version = { repository: 'pbuchman/fishing-assistant', sha };
/** @param {string} path @returns {string} */
function fingerprint(path) {
  const hash = createHash('sha256');
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const child = join(path, entry.name);
    hash.update(entry.name);
    hash.update(entry.isDirectory() ? fingerprint(child) : readFileSync(child));
  }
  return hash.digest('hex');
}
const stateFile = resolve(directory, 'prepared.json');
if (mode === 'prepare') {
  writeFileSync(join(dist, 'version.json'), `${JSON.stringify(version)}\n`);
  writeFileSync(
    `${stateFile}.tmp`,
    JSON.stringify({ sha, checkout: process.cwd(), distHash: fingerprint(dist) }),
    { mode: 0o600 }
  );
  renameSync(`${stateFile}.tmp`, stateFile);
} else if (mode === 'verify') {
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (
    saved.sha !== sha ||
    saved.checkout !== process.cwd() ||
    saved.distHash !== fingerprint(dist)
  ) {
    throw new Error('Prepared release changed; prepare again before activation');
  }
} else throw new Error('Unknown release state operation');

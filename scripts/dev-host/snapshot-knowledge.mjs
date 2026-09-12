import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cert, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const [mode, path] = process.argv.slice(2);
const projectId = process.env['FA_GCP_PROJECT_ID'];
const keyPath = process.env['FA_GCP_ADMIN_KEY_FILE'];
if (!path || !projectId || !keyPath || !['capture', 'compare'].includes(mode ?? '')) {
  throw new Error('Use capture|compare <private-snapshot-path> with explicit FA GCP configuration');
}
if (process.env['FIRESTORE_EMULATOR_HOST']) throw new Error('Emulators are not permitted');
/** @param {unknown} value @returns {unknown} */
function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if ('toArray' in value && typeof value.toArray === 'function') return canonical(value.toArray());
  if ('toMillis' in value && typeof value.toMillis === 'function') return value.toMillis();
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)])
  );
}
const app = initializeApp({
  projectId,
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
});
try {
  const db = getFirestore(app);
  /** @type {Record<string, Record<string, string>>} */
  const collections = {};
  for (const name of ['fa_knowledge_nodes', 'fa_knowledge_pages', 'fa_knowledge_chunks']) {
    const result = await db.collection(name).get();
    collections[name] = Object.fromEntries(
      result.docs
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((doc) => [
          doc.id,
          createHash('sha256')
            .update(JSON.stringify(canonical(doc.data())))
            .digest('hex'),
        ])
    );
    process.stdout.write(`${name}: ${result.size} documents\n`);
  }
  const snapshot = JSON.stringify({ projectId, database: '(default)', collections });
  if (mode === 'capture') writeFileSync(path, snapshot, { mode: 0o600, flag: 'wx' });
  else if (readFileSync(path, 'utf8') !== snapshot)
    throw new Error('Knowledge snapshot differs; investigate without modifying data');
  else process.stdout.write('All knowledge document IDs and content hashes match\n');
} finally {
  await deleteApp(app);
}

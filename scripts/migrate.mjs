#!/usr/bin/env node
// @ts-check

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const migrationsCollection = '_migrations';

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   description: string;
 *   createdAt: string;
 * }} MigrationMetadata
 *
 * @typedef {{
 *   collectionGroup: string;
 *   queryScope: string;
 *   fields: Array<Record<string, unknown>>;
 * }} FirestoreIndex
 *
 * @typedef {{
 *   id: string;
 *   name: string;
 *   file: string;
 *   filePath: string;
 *   checksum: string;
 *   metadata: MigrationMetadata;
 *   indexes: FirestoreIndex[];
 *   removedIndexes?: FirestoreIndex[];
 *   dropIndexes?: FirestoreIndex[];
 *   up: (context: MigrationContext) => Promise<void>;
 * }} DiscoveredMigration
 *
 * @typedef {{
 *   firestore: FirebaseFirestore.Firestore;
 *   deployIndexes: () => Promise<void>;
 *   markMigrationComplete: (metadata: MigrationMetadata) => Promise<void>;
 * }} MigrationContext
 *
 * @typedef {{
 *   status: boolean;
 *   liveStatus: boolean;
 *   project?: string;
 * }} MigrationCliOptions
 *
 * @typedef {{
 *   id: string;
 *   name: string;
 *   expectedChecksum: string;
 *   appliedChecksum: string;
 * }} MigrationChecksumDrift
 */

/**
 * @param {string[]} args
 * @returns {MigrationCliOptions}
 */
export function parseArgs(args = process.argv.slice(2)) {
  /** @type {MigrationCliOptions} */
  const options = { status: false, liveStatus: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      continue;
    }

    if (arg === '--status') {
      options.status = true;
      continue;
    }

    if (arg === '--live') {
      options.liveStatus = true;
      continue;
    }

    if (arg === '--project') {
      const value = args[index + 1];
      if (value === undefined || value.length === 0) {
        throw new Error('Missing value for --project');
      }

      options.project = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }

  return options;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function checksum(filePath) {
  return createHash('sha256').update(readFileSync(filePath, 'utf8')).digest('hex').slice(0, 16);
}

/**
 * @param {string} root
 * @returns {Promise<DiscoveredMigration[]>}
 */
export async function discoverMigrations(root = repoRoot) {
  const directory = resolve(root, 'migrations');
  if (!existsSync(directory)) {
    return [];
  }

  const files = readdirSync(directory)
    .filter((file) => /^\d{3}[_-].+\.mjs$/.test(file))
    .sort();

  /** @type {DiscoveredMigration[]} */
  const migrations = [];
  for (const file of files) {
    const filePath = resolve(directory, file);
    const match = file.match(/^(\d{3})[_-](.+)\.mjs$/);
    if (match === null) {
      continue;
    }

    const module =
      /** @type {{ metadata?: MigrationMetadata; indexes?: FirestoreIndex[]; removedIndexes?: FirestoreIndex[]; dropIndexes?: FirestoreIndex[]; up?: DiscoveredMigration['up'] }} */ (
        await import(pathToFileURL(filePath).href)
      );
    if (module.metadata === undefined || typeof module.up !== 'function') {
      throw new Error(`Invalid migration file ${file} - missing metadata or up function`);
    }

    migrations.push({
      id: match[1] ?? module.metadata.id,
      name: module.metadata.name,
      file,
      filePath,
      checksum: checksum(filePath),
      metadata: module.metadata,
      indexes: module.indexes ?? [],
      ...(module.removedIndexes !== undefined ? { removedIndexes: module.removedIndexes } : {}),
      ...(module.dropIndexes !== undefined ? { dropIndexes: module.dropIndexes } : {}),
      up: module.up,
    });
  }

  return migrations;
}

/**
 * @param {FirestoreIndex} index
 * @returns {FirestoreIndex}
 */
export function normalizeFirestoreIndex(index) {
  return {
    ...index,
    fields: index.fields.map((field) => {
      if (!('vectorConfig' in field)) {
        return field;
      }

      const vectorConfig = field['vectorConfig'];
      const rest = { ...field };
      delete rest['order'];
      delete rest['vectorConfig'];
      const dimension =
        vectorConfig !== null &&
        typeof vectorConfig === 'object' &&
        'dimension' in vectorConfig &&
        typeof vectorConfig.dimension === 'number'
          ? vectorConfig.dimension
          : undefined;

      return {
        ...rest,
        vectorConfig: {
          ...(dimension === undefined ? {} : { dimension }),
          flat: {},
        },
      };
    }),
  };
}

/**
 * @param {FirestoreIndex} index
 * @returns {string}
 */
function firestoreIndexKey(index) {
  return JSON.stringify(normalizeFirestoreIndex(index));
}

/**
 * @param {{ removedIndexes?: FirestoreIndex[]; dropIndexes?: FirestoreIndex[] }} migration
 * @returns {FirestoreIndex[]}
 */
function removedFirestoreIndexes(migration) {
  return [...(migration.removedIndexes ?? []), ...(migration.dropIndexes ?? [])];
}

/**
 * @param {Array<{
 *   indexes: FirestoreIndex[];
 *   removedIndexes?: FirestoreIndex[];
 *   dropIndexes?: FirestoreIndex[];
 * }>} migrations
 * @param {string} root
 * @returns {void}
 */
export function writeFirestoreIndexes(migrations, root = repoRoot) {
  /** @type {Map<string, FirestoreIndex>} */
  const indexes = new Map();
  for (const migration of migrations) {
    for (const removedIndex of removedFirestoreIndexes(migration)) {
      indexes.delete(firestoreIndexKey(removedIndex));
    }

    for (const index of migration.indexes) {
      const normalized = normalizeFirestoreIndex(index);
      indexes.set(firestoreIndexKey(normalized), normalized);
    }
  }

  const outputPath = resolve(root, 'firestore.indexes.json');
  writeFileSync(
    outputPath,
    `${JSON.stringify({ indexes: [...indexes.values()], fieldOverrides: [] }, null, 2)}\n`
  );
}

/**
 * @param {DiscoveredMigration[]} migrations
 * @param {Map<string, Record<string, unknown>>} applied
 * @returns {MigrationChecksumDrift[]}
 */
export function detectMigrationChecksumDrift(migrations, applied = new Map()) {
  /** @type {MigrationChecksumDrift[]} */
  const drift = [];
  for (const migration of migrations) {
    const record = applied.get(migration.id);
    if (record?.['status'] !== 'applied') {
      continue;
    }

    const appliedChecksum =
      typeof record['checksum'] === 'string' ? record['checksum'] : migration.checksum;
    if (appliedChecksum === migration.checksum) {
      continue;
    }

    drift.push({
      id: migration.id,
      name: migration.name,
      expectedChecksum: migration.checksum,
      appliedChecksum,
    });
  }
  return drift;
}

/**
 * @param {MigrationChecksumDrift[]} drift
 * @returns {string}
 */
function formatMigrationChecksumDriftError(drift) {
  return drift
    .map(
      (entry) =>
        `Migration checksum drift detected for ${entry.id} (${entry.name}): expected ${entry.expectedChecksum}, applied ${entry.appliedChecksum}`
    )
    .join('\n');
}

/**
 * @param {DiscoveredMigration[]} migrations
 * @param {Map<string, Record<string, unknown>>} applied
 * @returns {void}
 */
export function assertNoMigrationChecksumDrift(migrations, applied = new Map()) {
  const drift = detectMigrationChecksumDrift(migrations, applied);
  if (drift.length > 0) {
    throw new Error(formatMigrationChecksumDriftError(drift));
  }
}

/**
 * @param {DiscoveredMigration[]} migrations
 * @param {Map<string, Record<string, unknown>>} applied
 * @returns {string}
 */
export function formatMigrationStatus(migrations, applied = new Map()) {
  const lines = ['Migration Status', '', 'ID  | Name | Status'];
  const driftById = new Map(
    detectMigrationChecksumDrift(migrations, applied).map((entry) => [entry.id, entry])
  );
  for (const migration of migrations) {
    const drift = driftById.get(migration.id);
    const status =
      drift === undefined
        ? applied.has(migration.id)
          ? String(applied.get(migration.id)?.['status'])
          : 'pending'
        : `checksum drift (expected ${drift.expectedChecksum}, applied ${drift.appliedChecksum})`;
    lines.push(`${migration.id} | ${migration.name} | ${status}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {MigrationCliOptions} options
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function projectId(options, env = process.env) {
  const configured =
    options.project ??
    env['FA_GCP_PROJECT_ID'] ??
    env['GOOGLE_CLOUD_PROJECT'] ??
    env['GCLOUD_PROJECT'];
  if (configured === undefined || configured.length === 0) {
    throw new Error(
      'Missing --project, FA_GCP_PROJECT_ID, GOOGLE_CLOUD_PROJECT, or GCLOUD_PROJECT'
    );
  }

  return configured;
}

/**
 * @param {string} project
 * @returns {string[]}
 */
export function firebaseDeployArgs(project) {
  return ['deploy', '--only', 'firestore:indexes', `--project=${project}`, '--non-interactive'];
}

/**
 * @param {string} project
 * @param {string} root
 * @returns {Promise<void>}
 */
function runFirebaseDeployIndexes(project, root = repoRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const firebaseBin = resolve(root, 'node_modules', '.bin', 'firebase');
    const child = spawn(firebaseBin, firebaseDeployArgs(project), {
      cwd: root,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Firebase CLI exited with code ${String(code)}`));
    });
  });
}

/**
 * @param {string} configuredProjectId
 * @returns {Promise<FirebaseFirestore.Firestore>}
 */
async function initFirestore(configuredProjectId) {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault(), projectId: configuredProjectId });
  }

  return getFirestore();
}

/**
 * @param {FirebaseFirestore.Firestore} firestore
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
async function getAppliedMigrations(firestore) {
  const snapshot = await firestore.collection(migrationsCollection).get();
  /** @type {Map<string, Record<string, unknown>>} */
  const applied = new Map();
  snapshot.forEach((doc) => {
    applied.set(doc.id, doc.data());
  });
  return applied;
}

/**
 * @param {FirebaseFirestore.Firestore} firestore
 * @param {MigrationMetadata} metadata
 * @param {string} migrationChecksum
 * @returns {Promise<void>}
 */
async function markMigrationComplete(firestore, metadata, migrationChecksum) {
  await firestore
    .collection(migrationsCollection)
    .doc(metadata.id)
    .set({
      ...metadata,
      checksum: migrationChecksum,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    });
}

async function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}\nUsage: node scripts/migrate.mjs [--status] [--project <id>]\n`
    );
    process.exit(1);
  }

  const migrations = await discoverMigrations();
  if (options.status) {
    if (!options.liveStatus) {
      process.stdout.write(formatMigrationStatus(migrations));
      return;
    }

    const configuredProjectId = projectId(options);
    const firestore = await initFirestore(configuredProjectId);
    const applied = await getAppliedMigrations(firestore);
    process.stdout.write(formatMigrationStatus(migrations, applied));
    assertNoMigrationChecksumDrift(migrations, applied);
    return;
  }

  const configuredProjectId = projectId(options);
  const firestore = await initFirestore(configuredProjectId);
  const applied = await getAppliedMigrations(firestore);
  assertNoMigrationChecksumDrift(migrations, applied);

  for (const migration of migrations) {
    const record = applied.get(migration.id);
    if (record?.['status'] === 'applied') {
      continue;
    }

    const context = {
      firestore,
      deployIndexes: async () => {
        writeFirestoreIndexes(migrations);
        process.stdout.write('Wrote firestore.indexes.json. Deploying Firestore indexes...\n');
        await runFirebaseDeployIndexes(configuredProjectId);
        process.stdout.write('Deployed Firestore indexes.\n');
      },
      /** @param {MigrationMetadata} metadata */
      markMigrationComplete: async (metadata) => {
        await markMigrationComplete(firestore, metadata, migration.checksum);
      },
    };

    await migration.up(context);
    await markMigrationComplete(firestore, migration.metadata, migration.checksum);
    process.stdout.write(`Applied ${migration.id} | ${migration.name}\n`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration runner failed: ${message}\n`);
    process.exit(1);
  });
}

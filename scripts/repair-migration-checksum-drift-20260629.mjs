#!/usr/bin/env node
// @ts-check

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverMigrations } from './migrate.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), '..');
const migrationsCollection = '_migrations';

export const KNOWN_MIGRATION_CHECKSUM_REPAIRS = [
  {
    id: '016',
    appliedChecksum: '9c12778b2a27e12e',
    currentChecksum: 'cd86ae512f5fdc22',
    expectedLedgerMetadata: {
      name: 'update-chat-model-catalog-pricing',
      description: 'Seed MiniMax-first chat model pricing and reset retired selected chat models',
      createdAt: '2026-06-22',
    },
    reason:
      'Repair applied ledger checksum drift for migration 016 after the checked-in migration file changed post-apply.',
  },
  {
    id: '018',
    appliedChecksum: 'e6ac9e760615c858',
    currentChecksum: '6936d9c06fde2ad3',
    expectedLedgerMetadata: {
      name: 'set-gemini-flash-lite-chat-model',
      description: 'Select Gemini 3.1 Flash Lite as the runtime chat model',
      createdAt: '2026-06-24',
    },
    reason:
      'Repair applied ledger checksum drift for migration 018 after the checked-in migration file changed post-apply.',
  },
];

/**
 * @param {string[]} args
 * @returns {{ apply: boolean; project?: string }}
 */
export function parseArgs(args = process.argv.slice(2)) {
  /** @type {{ apply: boolean; project?: string }} */
  const options = { apply: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
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
 * @param {{ project?: string }} options
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
 * @param {Record<string, unknown>} record
 * @param {(typeof KNOWN_MIGRATION_CHECKSUM_REPAIRS)[number]} repair
 * @returns {void}
 */
function assertExpectedLedgerRecord(record, repair) {
  if (record['status'] !== 'applied') {
    throw new Error(`Refusing to repair ${repair.id}: expected applied status`);
  }

  if (record['checksum'] !== repair.appliedChecksum) {
    throw new Error(
      `Refusing to repair ${repair.id}: expected applied checksum ${repair.appliedChecksum}, found ${String(
        record['checksum']
      )}`
    );
  }

  for (const [key, value] of Object.entries(repair.expectedLedgerMetadata)) {
    if (record[key] !== value) {
      throw new Error(
        `Refusing to repair ${repair.id}: expected ledger ${key} ${value}, found ${String(
          record[key]
        )}`
      );
    }
  }
}

/**
 * @param {{
 *   firestore: { collection: (name: string) => { doc: (id: string) => { get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (value: Record<string, unknown>) => Promise<unknown> } } };
 *   migrations: Array<{ id: string; name: string; checksum: string }>;
 *   apply: boolean;
 *   now?: string;
 * }} input
 * @returns {Promise<Array<{ id: string; previousChecksum: string; repairedChecksum: string; applied: boolean }>>}
 */
export async function repairMigrationChecksumDrift(input) {
  const now = input.now ?? new Date().toISOString();
  const migrationsById = new Map(input.migrations.map((migration) => [migration.id, migration]));
  /** @type {Array<{ id: string; previousChecksum: string; repairedChecksum: string; applied: boolean }>} */
  const repairs = [];

  for (const repair of KNOWN_MIGRATION_CHECKSUM_REPAIRS) {
    const migration = migrationsById.get(repair.id);
    if (migration === undefined) {
      throw new Error(`Refusing to repair ${repair.id}: migration file is missing`);
    }

    if (migration.checksum !== repair.currentChecksum) {
      throw new Error(
        `Refusing to repair ${repair.id}: expected current checksum ${repair.currentChecksum}, found ${migration.checksum}`
      );
    }

    const ref = input.firestore.collection(migrationsCollection).doc(repair.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Refusing to repair ${repair.id}: live migration record is missing`);
    }

    const record = snapshot.data();
    if (record === undefined) {
      throw new Error(`Refusing to repair ${repair.id}: live migration record has no data`);
    }
    assertExpectedLedgerRecord(record, repair);

    if (input.apply) {
      await ref.set({
        ...record,
        checksum: repair.currentChecksum,
        repairedAt: now,
        repairPreviousChecksum: repair.appliedChecksum,
        repairReason: repair.reason,
        repairCurrentMigrationName: migration.name,
      });
    }

    repairs.push({
      id: repair.id,
      previousChecksum: repair.appliedChecksum,
      repairedChecksum: repair.currentChecksum,
      applied: input.apply,
    });
  }

  return repairs;
}

async function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}\nUsage: node scripts/repair-migration-checksum-drift-20260629.mjs [--apply] [--project <id>]\n`
    );
    process.exit(1);
  }

  const configuredProjectId = projectId(options);
  const firestore = await initFirestore(configuredProjectId);
  const migrations = await discoverMigrations(repoRoot);
  const repairs = await repairMigrationChecksumDrift({
    firestore,
    migrations,
    apply: options.apply,
  });

  for (const repair of repairs) {
    process.stdout.write(
      `${repair.applied ? 'Repaired' : 'Would repair'} ${repair.id}: ${repair.previousChecksum} -> ${repair.repairedChecksum}\n`
    );
  }
  if (!options.apply) {
    process.stdout.write(
      'Dry run only. Re-run with --apply to update the live migration ledger.\n'
    );
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration checksum repair failed: ${message}\n`);
    process.exit(1);
  });
}

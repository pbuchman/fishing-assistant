import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** @typedef {{id: string, requestedSha: string, status: string, attempts: number, sha?: string}} Job */

/**
 * Durable single-worker queue. The handler's systemd command holds an OS flock
 * for its whole lifetime; deployment itself uses a separate shared deploy lock.
 * A restarted worker retries interrupted work against current remote main.
 */
export class DeploymentQueue {
  /** @param {string} directory @param {(job: Job) => Promise<string>} execute */
  constructor(directory, execute) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.path = join(directory, 'jobs.json');
    this.execute = execute;
    /** @type {Job[]} */
    this.jobs = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : [];
    if (!Array.isArray(this.jobs)) throw new Error('Invalid deployment queue');
    for (const job of this.jobs) {
      if (job.status === 'running') job.status = 'pending';
    }
    this.stopped = false;
    /** @type {Promise<void> | undefined} */
    this.active = undefined;
    this.persist();
    this.schedule();
  }

  persist() {
    const temporary = `${this.path}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(this.jobs));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.path);
    const directory = openSync(this.directory, 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }

  /** @param {string} delivery @param {string} requestedSha */
  accept(delivery, requestedSha) {
    const id = createHash('sha256').update(delivery).digest('hex');
    let job = this.jobs.find((candidate) => candidate.id === id);
    if (job && job.requestedSha !== requestedSha) throw new Error('Delivery payload changed');
    if (!job) {
      job = { id, requestedSha, status: 'pending', attempts: 0 };
      this.jobs.push(job);
    } else if (job.status === 'failed') {
      job.status = 'pending';
    }
    this.persist();
    this.schedule();
    return { ...job };
  }

  /** @param {string} id */
  get(id) {
    return { ...this.jobs.find((job) => job.id === id) };
  }

  schedule() {
    if (this.stopped || this.active) return;
    this.active = new Promise((resolve) => setImmediate(() => resolve(undefined)))
      .then(() => this.run())
      .finally(() => {
        this.active = undefined;
      });
  }

  async run() {
    while (!this.stopped) {
      const job = this.jobs.find((candidate) => candidate.status === 'pending');
      if (!job) return;
      job.status = 'running';
      job.attempts++;
      this.persist();
      this.log(job, 'starting');
      try {
        job.sha = await this.execute({ ...job });
        job.status = 'succeeded';
      } catch {
        job.status = 'failed';
      }
      this.persist();
      this.log(job, 'finished');
    }
  }

  /** @param {Job} job @param {string} stage */
  log(job, stage) {
    process.stdout.write(
      `${JSON.stringify({ jobId: job.id, stage, sha: job.sha ?? job.requestedSha, status: job.status })}\n`
    );
  }

  async close() {
    this.stopped = true;
    await this.active;
  }
}

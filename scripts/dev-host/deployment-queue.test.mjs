import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeploymentQueue } from './deployment-queue.mjs';

const sha = 'a'.repeat(40);
/** @param {() => boolean} predicate */
const wait = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('queue did not reach expected state');
};

test('durably accepts work before execution and serializes duplicate deliveries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-queue-'));
  let release = () => {};
  const blocked = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let calls = 0;
  const queue = new DeploymentQueue(dir, async () => {
    calls++;
    await blocked;
    return sha;
  });
  try {
    const first = queue.accept('delivery-one', sha);
    assert.equal(first.status, 'pending');
    assert.equal(queue.accept('delivery-one', sha).id, first.id);
    await wait(() => calls === 1);
    assert.equal(queue.accept('delivery-one', sha).status, 'running');
    release();
    await wait(() => queue.get(first.id).status === 'succeeded');
    assert.equal(queue.accept('delivery-one', sha).status, 'succeeded');
    assert.equal(calls, 1);
    const restarted = new DeploymentQueue(dir, async () => {
      assert.fail('completed work repeated');
    });
    assert.equal(restarted.accept('delivery-one', sha).status, 'succeeded');
    await restarted.close();
  } finally {
    await queue.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed work remains failed until explicit redelivery and can then succeed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-queue-'));
  let calls = 0;
  const queue = new DeploymentQueue(dir, async () => {
    if (++calls === 1) throw new Error('private command output');
    return sha;
  });
  try {
    const job = queue.accept('retry-me', sha);
    await wait(() => queue.get(job.id).status === 'failed');
    assert.equal('error' in queue.get(job.id), false);
    assert.equal(queue.accept('retry-me', sha).status, 'pending');
    await wait(() => queue.get(job.id).status === 'succeeded');
    assert.equal(calls, 2);
  } finally {
    await queue.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending and interrupted jobs survive restart and execute in order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-queue-restart-'));
  const queue = new DeploymentQueue(dir, async () => sha);
  const first = queue.accept('first', sha);
  const second = queue.accept('second', sha);
  await queue.close();
  // Simulate a handler dying after persisting the running stage.
  if (queue.jobs[0]) queue.jobs[0].status = 'running';
  queue.persist();
  /** @type {string[]} */
  const order = [];
  const resumed = new DeploymentQueue(dir, async (job) => {
    order.push(job.id);
    return sha;
  });
  try {
    await wait(() => resumed.get(second.id).status === 'succeeded');
    assert.deepEqual(order, [first.id, second.id]);
  } finally {
    await resumed.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

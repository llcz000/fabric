import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { withSmokeProcessLifecycle } from './smokeLifecycle.mjs';

test('setup failure removes its temp directory without spawning a child', async () => {
  const events: string[] = [];
  await assert.rejects(withSmokeProcessLifecycle({
    createTempDir() { events.push('create'); return 'temp-setup'; },
    async setup() { events.push('setup'); throw new Error('fixture setup failed'); },
    spawnChild() { events.push('spawn'); return new EventEmitter(); },
    async run() { events.push('run'); },
    async stopChild() { events.push('stop'); },
    async removeTempDir(tempDir: string) { events.push(`remove:${tempDir}`); },
  }), /fixture setup failed/);
  assert.deepEqual(events, ['create', 'setup', 'remove:temp-setup']);
});

test('synchronous spawn failure removes its temp directory without stopping a missing child', async () => {
  const events: string[] = [];
  await assert.rejects(withSmokeProcessLifecycle({
    createTempDir() { events.push('create'); return 'temp-spawn'; },
    async setup() { events.push('setup'); return { port: 3001 }; },
    spawnChild() { events.push('spawn'); throw new Error('spawn failed'); },
    async run() { events.push('run'); },
    async stopChild() { events.push('stop'); },
    async removeTempDir(tempDir: string) { events.push(`remove:${tempDir}`); },
  }), /spawn failed/);
  assert.deepEqual(events, ['create', 'setup', 'spawn', 'remove:temp-spawn']);
});

test('child error rejects once, stops that child, and removes its temp directory', async () => {
  const events: string[] = [];
  const child = new EventEmitter();
  const result = withSmokeProcessLifecycle({
    createTempDir() { events.push('create'); return 'temp-child-error'; },
    async setup() { events.push('setup'); return { port: 3002 }; },
    spawnChild() {
      events.push('spawn');
      queueMicrotask(() => {
        child.emit('error', new Error('child process error'));
        child.emit('exit', 1, null);
      });
      return child;
    },
    async run() {
      events.push('run');
      return new Promise(() => {});
    },
    async stopChild(value: EventEmitter) {
      assert.equal(value, child);
      events.push('stop');
    },
    async removeTempDir(tempDir: string) { events.push(`remove:${tempDir}`); },
  });

  await assert.rejects(result, /child process error/);
  assert.deepEqual(events, ['create', 'setup', 'spawn', 'run', 'stop', 'remove:temp-child-error']);
});

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { browser, copy, list } from './helpers.js';

test('editing titles, colors, items and order persists the same list format', async () => {
  const b = browser({ local: [{ title: 'Local', bg: '', online: false }] });
  const actions = b.workspace.actions;
  actions.editTitle('local', 'Weekend');
  actions.editColor('local', '#e0e9f1');
  actions.addItem('local', 'Walk');
  actions.addItem('local', 'Read');
  actions.editItem('local', 1, 'Walk by the lake');
  actions.setDone('local', 2, true);
  actions.moveItem('local', 2, 1);
  await b.flush();
  assert.deepEqual(b.saved().local, [
    { title: 'Weekend', bg: '#e0e9f1', online: false },
    { title: 'Read', done: true },
    { title: 'Walk by the lake', done: false },
  ]);
  actions.removeItem('local', 1);
  await b.flush();
  assert.equal(b.saved().local.length, 2);
  assert.equal(b.requests.length, 0);
});

test('invalid stored lists stop startup rather than saving an empty workspace', () => {
  for (const stored of ['{broken', '[]', '{"bad":[]}']) {
    assert.throws(() => browser({}, { liststorage: stored }));
  }
});

test('null server responses leave the current list intact', async () => {
  const b = browser();
  b.requests[0].reply(null);
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.match(b.workspace.statuses.shared.error, /empty or invalid/);
});

test('dispose removes listeners and ignores responses from the old workspace', async () => {
  const b = browser();
  assert.equal(b.listeners.size, 3);
  b.dispose();
  b.requests[0].reply(list('Old response'));
  await b.tick();
  assert.equal(b.listeners.size, 0);
  assert.deepEqual(b.saved().shared, list('Milk'));
});

test('the next save after a storage failure does not upload unpersisted contents', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  const write = b.workspace.sync.storage.writeLists;
  b.workspace.sync.storage.writeLists = () => {
    throw new Error('Storage full');
  };
  b.workspace.actions.addItem('shared', 'Keep this');
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.posts().length, 0);
  assert.match(b.workspace.storageError.value, /Storage full/);
  assert.deepEqual(copy(b.workspace.lists.shared), list('Milk', 'Keep this'));
  b.workspace.sync.storage.writeLists = write;
  b.workspace.sync.flush();
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Keep this'));
  assert.equal(b.posts().length, 1, 'a successful local retry resumes the pending upload');
});

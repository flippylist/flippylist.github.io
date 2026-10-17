import assert from 'node:assert/strict';
import { test } from 'vitest';
import { access, browser, list, token } from './helpers.js';
import { createApi } from '../src/services/api.js';

test('adding a list sends its ID and PIN in one request and remembers access', async () => {
  const b = browser({});
  const answers = ['pinned', '012345'];
  b.context.prompt = () => answers.shift();
  const added = b.workspace.actions.addList();
  assert.equal(b.requests.length, 1);
  assert.ok(b.requests[0].url.endsWith('/api/join'));
  assert.deepEqual(JSON.parse(b.requests[0].body), { id: 'pinned', pin: '012345' });
  assert.equal(b.requests[0].url.includes('012345'), false);
  b.requests[0].reply(list('Milk'));
  await added;
  await b.tick();
  assert.deepEqual(b.saved().pinned, list('Milk'));
  assert.equal(b.requests.length, 1);
  const metadata = JSON.parse(b.storage.get('liststorage:sync')).pinned;
  assert.equal(metadata.access, access);
  assert.equal(metadata.pin, null);
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  assert.equal(reopened.requests[0].headers.Authorization, `Bearer ${access}`);
  reopened.dispose();
  b.dispose();
});

test('a wrong PIN does not add or overwrite a list', async () => {
  const b = browser({});
  b.context.prompt = (message) => (message.includes('PIN') ? '999999' : 'pinned');
  let message;
  b.context.alert = (value) => {
    message = value;
  };
  const added = b.workspace.actions.addList();
  b.requests[0].reply({ error: 'Incorrect PIN.', code: 'INVALID_PIN' }, 403);
  await added;
  assert.deepEqual(b.saved(), {});
  assert.match(message, /Incorrect PIN/);
  assert.equal(b.requests.length, 1);
});

test('a PIN attempt limit gives a useful error even without a JSON response', async () => {
  const api = createApi({
    baseUrl: '',
    hostname: 'localhost',
    fetch: async () => ({ status: 429, ok: false }),
  });
  await assert.rejects(api.join('shared', '123456'), /Too many attempts.*minute/);
});

test('cancelled or invalid PIN entry never enables sharing', async () => {
  for (const answer of [null, '', '123', 'abcdef']) {
    const b = browser({ local: [{ title: 'Local', online: false }] });
    b.context.prompt = () => answer;
    b.workspace.actions.toggleOnline('local');
    await b.tick();
    assert.equal(b.saved().local[0].online, false);
    assert.equal(b.requests.length, 0);
  }
});

test('first sharing sends the PIN once and later edits use remembered access', async () => {
  const b = browser({ local: [{ title: 'Local', online: false }] });
  b.workspace.actions.toggleOnline('local');
  await b.tick();
  assert.equal(b.requests.length, 1);
  assert.equal(JSON.parse(b.requests[0].body).pin, '123456');
  b.requests[0].reply({});
  await b.tick();
  assert.equal(JSON.parse(b.storage.get('liststorage:sync')).local.pin, null);
  b.workspace.actions.editTitle('local', 'Edited');
  await b.tick();
  assert.equal(b.requests.length, 2);
  assert.equal(JSON.parse(b.requests[1].body).pin, undefined);
  assert.equal(b.requests[1].headers.Authorization, `Bearer ${access}`);
});

test('changing a PIN uses one request and does not replace local contents', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  const changed = b.workspace.actions.setPin('shared');
  assert.equal(b.requests.length, 2);
  assert.equal(JSON.parse(b.requests[1].body).action, 'pin');
  assert.equal(b.requests[1].headers.Authorization, `Bearer ${access}`);
  b.requests[1].reply({
    list: list('Other device'),
    revision: token(list('Other device')),
    access,
    hasPin: true,
  });
  await changed;
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.workspace.statuses.shared.hasPin, true);
  assert.equal(b.requests.length, 2);
});

test('a cached list can regain access without losing local edits', async () => {
  const b = browser();
  b.requests[0].reply({ error: 'Enter PIN', code: 'PIN_REQUIRED' }, 401);
  await b.tick();
  const unlocked = b.workspace.actions.setPin('shared');
  b.requests[1].reply(list('Different online copy'));
  await unlocked;
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.workspace.statuses.shared.access, access);
  assert.equal(b.requests.length, 2);
});

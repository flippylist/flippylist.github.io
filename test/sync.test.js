import assert from 'node:assert/strict';
import { test } from 'vitest';
import { browser, copy, list, token } from './helpers.js';

test('an empty online response cannot clear the saved list', async () => {
  const b = browser();
  b.requests[0].reply([]);
  await b.tick();
  assert.deepEqual(copy(b.workspace.lists.shared), list('Milk'));
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.posts().length, 0);
});

test('HTTP errors cannot replace a list even if their JSON looks like a list', async () => {
  const b = browser();
  b.requests[0].reply(list(), 500);
  await b.tick();
  assert.deepEqual(copy(b.workspace.lists.shared), list('Milk'));
  assert.deepEqual(b.saved().shared, list('Milk'));
});

test('a delayed startup download cannot erase edits made while it was loading', async () => {
  const b = browser();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  assert.equal(b.posts().length, 0, 'wait for the initial download before uploading');
  b.requests[0].reply(list());
  await b.tick();
  assert.deepEqual(copy(b.workspace.lists.shared), list('Milk', 'Bread'));
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  assert.equal(b.posts().length, 0, 'conflicting edits must not overwrite the server');
});

test('downloading a list does not upload it again', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk', 'Bread'));
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  assert.equal(b.posts().length, 0);
});

test('local edits are saved before the upload debounce expires', async () => {
  const b = browser({ local: [{ title: 'Local' }] });
  b.workspace.lists.local.push({ title: 'Remember this', done: false });
  await b.flush();
  assert.equal(b.saved().local[1].title, 'Remember this');
});

test('uploads of the same list are serialized and the latest edit is sent next', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  assert.equal(b.posts().length, 1);
  b.workspace.lists.shared.push({ title: 'Eggs', done: false });
  await b.tick();
  assert.equal(b.posts().length, 1, 'only one upload may be in flight per list');
  b.posts()[0].reply({});
  await b.tick();
  assert.equal(b.posts().length, 2);
  assert.deepEqual(JSON.parse(b.posts()[1].body).list, list('Milk', 'Bread', 'Eggs'));
});

test('cancelling the add-list prompt does not create a list', async () => {
  const b = browser({});
  b.workspace.actions.addList();
  await b.tick();
  assert.deepEqual(b.saved(), {});
});

test('new six-character list IDs skip collisions in this tab and saved storage', async () => {
  const existing = [{ title: 'Keep this list', bg: '', online: false }];
  const b = browser({ '000000': existing });
  b.storage.set('liststorage', JSON.stringify({ '000000': existing, 111111: existing }));
  let attempt = 0;
  b.context.crypto = { getRandomValues: (bytes) => bytes.fill(attempt++) };
  b.context.prompt = () => '';
  await b.workspace.actions.addList();
  await b.flush();
  assert.equal(attempt, 3);
  assert.deepEqual(b.saved()['000000'], existing);
  assert.deepEqual(b.saved()['111111'], existing);
  assert.deepEqual(b.saved()['222222'], [{ title: '...', bg: '', online: false }]);
  assert.equal(b.requests.length, 0, 'new offline lists do not require a server connection');
});

test('a title-only online copy cannot silently remove all local tasks', async () => {
  const b = browser();
  b.requests[0].reply(list());
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.match(b.workspace.statuses.shared.error, /no items/);
  assert.equal(b.posts().length, 0);
});

test('startup removes existing recovery copies and stored contents without changing current lists', async () => {
  const current = { shared: list('Unsent edit') };
  const b = browser(current, {
    'liststorage:backups': JSON.stringify({ shared: [{ list: list('Old backup') }] }),
    'liststorage:sync': JSON.stringify({
      shared: {
        revision: ['old-snapshot'],
        baseline: JSON.stringify(list('Old baseline')),
        pending: true,
        unpublished: false,
      },
      removed: { baseline: JSON.stringify(list('Removed list')), deleted: true },
    }),
  });
  assert.deepEqual(b.saved(), current);
  assert.equal(b.storage.has('liststorage:backups'), false);
  const metadata = JSON.parse(b.storage.get('liststorage:sync'));
  assert.equal(metadata.shared.revision, null);
  assert.equal(metadata.shared.pending, true);
  assert.equal(metadata.removed.deleted, true);
  assert.ok(Object.values(metadata).every((value) => !Object.hasOwn(value, 'baseline')));
  b.requests[0].reply(list('Different online copy'));
  await b.tick();
  assert.deepEqual(b.saved(), current, 'unsent edits survive removal of the old sync metadata');
  assert.equal(b.posts().length, 0);
  assert.ok(b.workspace.statuses.shared.conflictRevision);
});

test('valid online changes replace local data without saving a recovery copy', async () => {
  const b = browser();
  b.requests[0].reply(list('Bread'));
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Bread'));
  assert.equal(b.storage.has('liststorage:backups'), false);
  assert.equal(b.storage.get('liststorage:sync').includes('Milk'), false);
});

test('an explicit online reload can clear tasks without retaining the prior copy', async () => {
  const b = browser();
  b.requests[0].reply(list());
  await b.tick();
  b.workspace.actions.loadOnlineCopy('shared');
  b.requests[1].reply(list());
  await b.tick();
  assert.deepEqual(b.saved().shared, list());
  assert.equal(b.storage.has('liststorage:backups'), false);
  assert.equal(b.posts().length, 0);
});

test('failed uploads keep unsent edits across a refresh and retry', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  b.posts()[0].reply({}, 503);
  await b.tick();
  assert.match(b.workspace.statuses.shared.error, /Upload failed/);
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  reopened.requests[0].reply(list('Milk'));
  await reopened.tick();
  assert.deepEqual(reopened.saved().shared, list('Milk', 'Bread'));
  assert.equal(reopened.posts().length, 1);
  reopened.posts()[0].reply(null, 204);
  await reopened.tick();
  assert.equal(JSON.parse(reopened.storage.get('liststorage:sync')).shared.pending, false);
});

test('unsent edits and independent server edits cause a visible conflict on refresh', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.flush();
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  reopened.requests[0].reply(list('Eggs'));
  await reopened.tick();
  assert.deepEqual(reopened.saved().shared, list('Milk', 'Bread'));
  assert.equal(reopened.posts().length, 0);
  assert.match(reopened.workspace.statuses.shared.error, /differs from your unsent edits/);
});

test('edits after a failed initial download require choosing a current copy', async () => {
  const b = browser();
  b.requests[0].reject(new Error('Offline'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  assert.equal(b.posts().length, 0);
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  b.workspace.actions.retrySync('shared');
  b.requests[1].reply(list('Milk'));
  await b.tick();
  assert.equal(b.posts().length, 0);
  assert.equal(b.workspace.statuses.shared.conflictRevision, token(list('Milk')));
  b.workspace.actions.resolveList('shared');
  await b.flush();
  assert.equal(b.posts().length, 1);
});

test('edits during an unchanged startup download are uploaded after it completes', async () => {
  const b = browser();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  assert.equal(b.posts().length, 1);
});

test('editing one list preserves another list saved by a different tab', async () => {
  const a = [{ title: 'A' }];
  const b = browser({ a, b: [{ title: 'B' }] });
  b.storage.set('liststorage', JSON.stringify({ a, b: [{ title: 'New B' }] }));
  b.workspace.lists.a[0].title = 'New A';
  await b.flush();
  assert.equal(b.saved().a[0].title, 'New A');
  assert.equal(b.saved().b[0].title, 'New B');
});

test('an old tab cannot overwrite a newer saved copy of the same list', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.storage.set('liststorage', JSON.stringify({ shared: list('Milk', 'Eggs') }));
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Eggs'));
  assert.equal(b.posts().length, 0);
  assert.match(b.workspace.statuses.shared.error, /another tab/);
  assert.deepEqual(copy(b.workspace.lists.shared), list('Milk', 'Bread'));
  assert.equal(b.storage.has('liststorage:backups'), false);
});

test('a late download cannot recreate a deleted list', async () => {
  const b = browser();
  const removed = b.workspace.actions.removeList('shared');
  await b.flush();
  b.requests.find((request) => request.method === 'DELETE').reply({ deleted: true });
  await removed;
  b.requests[0].reply(list('Milk'));
  await b.tick();
  assert.deepEqual(b.saved(), {});
  assert.deepEqual(copy(b.workspace.lists), {});
});

test('import rejects malformed data and safely encodes the list id', async () => {
  const b = browser({});
  b.context.prompt = () => 'a&b';
  const imported = b.workspace.actions.addList();
  assert.ok(b.requests[0].url.endsWith('?id=a%26b'));
  b.requests[0].reply({ error: 'not found' });
  await imported;
  await b.tick();
  assert.deepEqual(b.saved(), {});
});

test('newly enabled local lists are uploaded', async () => {
  const b = browser({ local: [{ title: 'Local' }] });
  b.workspace.actions.toggleOnline('local');
  await b.tick();
  assert.equal(b.posts().length, 1);
  assert.equal(JSON.parse(b.posts()[0].body).list[0].online, true);
});

test('invalid indices cannot remove or corrupt tasks', async () => {
  const b = browser({ a: list('Milk'), b: list('Bread') });
  b.workspace.actions.moveItem('a', -1, 1);
  b.workspace.actions.moveItem('a', 0, 1);
  b.workspace.actions.moveItem('a', 5, 1);
  b.workspace.actions.removeItem('a', -1);
  await b.flush();
  assert.deepEqual(copy(b.workspace.lists), { a: list('Milk'), b: list('Bread') });
});

test('an edit uses one save request with the last acknowledged revision', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  const before = b.requests.length;
  b.workspace.actions.editItem('shared', 1, 'Bread');
  await b.tick();
  assert.equal(b.requests.length, before + 1);
  const request = b.requests.at(-1);
  assert.equal(request.method, 'POST');
  assert.deepEqual(JSON.parse(request.body), {
    list: list('Bread'),
    revision: token(list('Milk')),
  });
  request.reply({});
  await b.tick();
  assert.equal(b.requests.length, before + 1, 'save confirmation requires no extra read');
  assert.equal(b.workspace.statuses.shared.pending, false);
});

test('last-save-wins sends an edit directly even when another device has changed the list', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.serverData.set('shared', list('Milk', 'Eggs'));
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  assert.equal(b.posts().length, 1);
  assert.equal(b.requests.length, 2, 'startup download and one save');
  assert.equal(JSON.parse(b.posts()[0].body).revision, token(list('Milk')));
  b.posts()[0].reply({});
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  assert.deepEqual(b.serverData.get('shared'), list('Milk', 'Bread'));
  assert.equal(b.workspace.statuses.shared.error, '');
  assert.equal(b.workspace.statuses.shared.pending, false);
  assert.equal(b.requests.length, 2);
});

test('an uncertain creation can be recovered with one explicit read after an ID-exists response', async () => {
  const b = browser(
    { local: list('Milk') },
    {
      'liststorage:sync': JSON.stringify({
        local: { unpublished: true, attempted: true, pending: true },
      }),
    },
  );
  await b.tick();
  assert.equal(b.requests.length, 1);
  b.posts()[0].reply({ code: 'LIST_EXISTS', error: 'This ID already exists. Retry sync.' }, 409);
  await b.tick();
  assert.equal(b.requests.length, 1, 'an ambiguous create does not trigger more calls');
  assert.equal(b.workspace.statuses.local.publication, 'published');
  const retry = b.workspace.actions.retrySync('local');
  b.requests[1].reply(list('Milk'));
  await retry;
  await b.tick();
  assert.equal(b.requests.length, 2);
  assert.equal(b.workspace.statuses.local.pending, false);
  assert.equal(b.workspace.statuses.local.error, '');
});

test('delete waits for an in-flight creation and then sends exactly one delete', async () => {
  const b = browser({ local: [{ title: 'Local', online: false }] });
  b.workspace.actions.toggleOnline('local');
  await b.tick();
  const removed = b.workspace.actions.removeList('local');
  await b.flush();
  assert.equal(b.requests.length, 1, 'wait for the insert to finish');
  b.posts()[0].reply({});
  await b.flush();
  assert.equal(b.requests.length, 2);
  assert.equal(b.requests[1].method, 'DELETE');
  b.requests[1].reply({ deleted: true });
  await removed;
  await b.tick();
  assert.deepEqual(b.saved(), {});
  assert.equal(b.requests.length, 2);
});

test('a newly published list survives a refresh before its first upload', async () => {
  const b = browser({ local: [{ title: 'Local' }] });
  b.workspace.actions.toggleOnline('local');
  await b.flush();
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  await reopened.tick();
  assert.equal(reopened.posts().length, 1);
  assert.equal(JSON.parse(reopened.posts()[0].body).list[0].title, 'Local');
});

test('moving to an empty server requires explicitly publishing the preserved local copy', async () => {
  const b = browser();
  b.requests[0].reply({ error: 'Not published', code: 'LIST_NOT_FOUND' }, 404);
  await b.tick();
  assert.equal(b.posts().length, 0);
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.workspace.statuses.shared.missing, true);
  b.workspace.actions.publishList('shared');
  await b.tick();
  assert.equal(JSON.parse(b.posts()[0].body).revision, null);
  b.posts()[0].reply({});
  await b.tick();
  assert.equal(b.workspace.statuses.shared.missing, false);
});

test('a rejected upload offers the two current copies without historical versions', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  const revision = token(list('Eggs'), 2);
  b.posts()[0].reply({ code: 'SYNC_CONFLICT', error: 'Concurrent saves', revision }, 409);
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  assert.equal(b.workspace.statuses.shared.conflictRevision, revision);
  b.workspace.actions.resolveList('shared');
  await b.flush();
  assert.equal(JSON.parse(b.posts()[1].body).revision, revision);
  b.posts()[1].reply({});
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk', 'Bread'));
  assert.equal(b.storage.has('liststorage:backups'), false);
  assert.equal(b.workspace.statuses.shared.conflictRevision, null);
});

test('even explicit downloads identify previously shared lists so deletion stops sync', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  const loaded = b.workspace.actions.loadOnlineCopy('shared');
  const url = new URL(b.requests[1].url, 'http://flippy.test');
  assert.equal(url.searchParams.get('known'), token(list('Milk')));
  b.requests[1].reply({ error: 'Deleted', code: 'LIST_DELETED' }, 410);
  await loaded;
  await b.tick();
  const kept = list('Milk');
  kept[0].online = false;
  assert.deepEqual(b.saved().shared, kept);
  assert.equal(b.workspace.statuses.shared.deletion, 'deleted');
  assert.equal(b.workspace.statuses.shared.missing, false);
});

test('GitHub Pages sends reads and saves to the configured Vercel origin without cookies', async () => {
  const b = browser(
    undefined,
    {},
    { hostname: 'example.github.io', apiBaseUrl: 'https://flippy-api.example/' },
  );
  assert.equal(b.requests[0].url, 'https://flippy-api.example/api/list?id=shared');
  assert.equal(b.requests[0].credentials, 'omit');
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Bread', done: false });
  await b.tick();
  assert.equal(b.posts()[0].url, 'https://flippy-api.example/api/list?id=shared');
  assert.equal(b.posts()[0].credentials, 'omit');
  assert.equal(b.posts()[0].headers['Content-Type'], 'application/json');
});

test('a hosted frontend without its API URL keeps local data and does not contact GitHub for sync', async () => {
  const b = browser(undefined, {}, { hostname: 'example.github.io' });
  await b.tick();
  assert.equal(b.requests.length, 0);
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.match(b.workspace.statuses.shared.error, /Set VITE_API_BASE_URL/);
});

test('invalid API configuration never sends list contents over an insecure public URL', async () => {
  for (const apiBaseUrl of [
    'http://flippy-api.example',
    'https://user:password@flippy-api.example',
    'https://flippy-api.example/api/list',
  ]) {
    const b = browser(undefined, {}, { hostname: 'example.github.io', apiBaseUrl });
    await b.tick();
    assert.equal(b.requests.length, 0);
    assert.deepEqual(b.saved().shared, list('Milk'));
  }
});

test('server deletion keeps every local item, stops sync, and survives refresh', async () => {
  const b = browser();
  b.workspace.lists.shared.push({ title: 'Unsent edit', done: true });
  b.requests[0].reply({ code: 'LIST_DELETED', error: 'Online list deleted' }, 410);
  await b.tick();
  const kept = list('Milk');
  kept.push({ title: 'Unsent edit', done: true });
  kept[0].online = false;
  assert.deepEqual(b.saved().shared, kept);
  assert.equal(b.workspace.statuses.shared.deletion, 'deleted');
  assert.equal(b.workspace.statuses.shared.missing, false);
  assert.equal(b.posts().length, 0);
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  reopened.workspace.lists.shared.push({ title: 'Still editable', done: false });
  reopened.workspace.actions.retrySync('shared');
  reopened.workspace.actions.publishList('shared');
  reopened.workspace.sync.refresh();
  await reopened.tick();
  assert.equal(reopened.requests.length, 0);
  assert.equal(reopened.saved().shared.at(-1).title, 'Still editable');
  assert.equal(reopened.workspace.statuses.shared.deletion, 'deleted');
});

test('sharing a surviving copy uses a new six-character ID and preserves its contents', async () => {
  const b = browser();
  b.requests[0].reply({ code: 'LIST_DELETED', error: 'Deleted' }, 410);
  await b.tick();
  const next = b.workspace.actions.shareAgain('shared');
  await b.tick();
  assert.match(next, /^[a-v0-9]{6}$/);
  assert.equal(b.saved().shared, undefined);
  assert.deepEqual(b.saved()[next], list('Milk'));
  assert.equal(b.posts().length, 1);
  assert.ok(b.posts()[0].url.endsWith('?id=' + next));
  assert.equal(JSON.parse(b.posts()[0].body).revision, null);
  b.posts()[0].reply({});
  await b.tick();
  assert.equal(b.workspace.sync.state(next).publication, 'published');
});

test('delete waits for server confirmation and blocks pending uploads and downloads', async () => {
  const b = browser();
  const removed = b.workspace.actions.removeList('shared');
  await b.flush();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.workspace.statuses.shared.activity, 'delete');
  b.requests[0].reply(list('Other device'));
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  const request = b.requests.find((request) => request.method === 'DELETE');
  assert.equal(request.credentials, 'omit');
  request.reply({ deleted: true });
  await removed;
  await b.tick();
  assert.deepEqual(b.saved(), {});
  assert.equal(b.posts().length, 0);
});

test('a failed delete preserves data and a persisted retry can finish after refresh', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  const removed = b.workspace.actions.removeList('shared');
  b.requests.find((request) => request.method === 'DELETE').reject(new Error('Offline'));
  await removed;
  await b.tick();
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.equal(b.workspace.statuses.shared.deletion, 'pending');
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  reopened.workspace.lists.shared.push({ title: 'Kept edit', done: false });
  reopened.workspace.actions.toggleOnline('shared');
  await reopened.tick();
  assert.equal(reopened.requests.length, 0, 'no sync while deletion is uncertain');
  assert.equal(reopened.workspace.statuses.shared.deletion, 'pending');
  const retry = reopened.workspace.actions.removeList('shared');
  reopened.requests[0].reply({ deleted: true });
  await retry;
  await reopened.tick();
  assert.deepEqual(reopened.saved(), {});
});

test('edits during deletion survive as a local-only copy', async () => {
  const b = browser();
  const removed = b.workspace.actions.removeList('shared');
  b.workspace.lists.shared.push({ title: 'Do not lose this', done: false });
  await b.flush();
  b.requests.find((request) => request.method === 'DELETE').reply({ deleted: true });
  await removed;
  b.requests[0].reply(list('Old download'));
  await b.tick();
  const kept = list('Milk', 'Do not lose this');
  kept[0].online = false;
  assert.deepEqual(b.saved().shared, kept);
  assert.equal(b.workspace.statuses.shared.deletion, 'deleted');
  assert.equal(b.posts().length, 0);
});

test('a late successful upload cannot restart sync after deletion', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.lists.shared.push({ title: 'Uploading', done: false });
  await b.tick();
  const removed = b.workspace.actions.removeList('shared');
  b.requests.find((request) => request.method === 'DELETE').reply({ deleted: true });
  await removed;
  b.posts()[0].reply({});
  await b.tick();
  assert.deepEqual(b.saved(), {});
  assert.equal(b.posts().length, 1);
});

test('an offline list that was shared still deletes the server copy', async () => {
  const b = browser();
  b.requests[0].reply(list('Milk'));
  await b.tick();
  b.workspace.actions.toggleOnline('shared');
  await b.flush();
  const removed = b.workspace.actions.removeList('shared');
  const request = b.requests.find((request) => request.method === 'DELETE');
  assert.ok(request);
  request.reply({ deleted: true });
  await removed;
  assert.deepEqual(b.saved(), {});
});

test('a never-shared local list can be removed without a connection', async () => {
  const b = browser({ local: [{ title: 'Local', online: false }] });
  await b.workspace.actions.removeList('local');
  await b.tick();
  assert.deepEqual(b.saved(), {});
  assert.equal(b.requests.length, 0);
});

test('an uncertain first upload still requires remote deletion after switching offline', async () => {
  const b = browser({ local: [{ title: 'Local', online: false }] });
  b.workspace.actions.toggleOnline('local');
  await b.tick();
  b.posts()[0].reject(new Error('Lost upload response'));
  await b.tick();
  b.workspace.actions.toggleOnline('local');
  await b.flush();
  const reopened = browser(b.saved(), Object.fromEntries(b.storage));
  const removed = reopened.workspace.actions.removeList('local');
  assert.equal(reopened.requests[0].method, 'DELETE');
  reopened.requests[0].reply({ deleted: true });
  await removed;
  assert.deepEqual(reopened.saved(), {});
});

test('unconfirmed delete responses and cancelled confirmations never discard a local copy', async () => {
  const b = browser();
  b.context.confirm = () => false;
  await b.workspace.actions.removeList('shared');
  assert.equal(b.requests.filter((request) => request.method === 'DELETE').length, 0);
  b.context.confirm = () => true;
  const removed = b.workspace.actions.removeList('shared');
  b.requests.find((request) => request.method === 'DELETE').reply({});
  await removed;
  assert.deepEqual(b.saved().shared, list('Milk'));
  assert.match(b.workspace.statuses.shared.error, /did not confirm/);
});

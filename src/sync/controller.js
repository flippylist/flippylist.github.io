import { clone, isValidList, isValidSyncToken, newListId, serialize } from '../domain/lists.js';
import { createSyncState, hasRemoteCopy, savedSyncState } from './state.js';

const conflict = (revision, message) =>
  Object.assign(new Error(message), { code: 'SYNC_CONFLICT', revision });
const defaultScheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (timer) => clearTimeout(timer),
};

// Coordinates current copies. Storage and transport are injected; no DOM or Vue dependency.
export class ListSync {
  constructor({
    lists,
    statuses,
    storage,
    api,
    reportStorageError,
    scheduler = defaultScheduler,
    random,
  }) {
    Object.assign(this, { lists, statuses, storage, api, reportStorageError, scheduler, random });
    this.previous = clone(lists);
    this.metadata = storage.initialize();
    this.requests = new Map();
    this.timers = new Map();
    this.incoming = new Map();
    this.storageError = '';
    Object.keys(lists).forEach((id) => this.state(id));
  }

  state(id) {
    if (!this.statuses[id]) this.statuses[id] = createSyncState(this.metadata[id], this.lists[id]);
    return this.statuses[id];
  }

  remember(id) {
    this.storage.writeMetadata(id, savedSyncState(this.state(id)));
  }

  rememberAccess(id, online) {
    const state = this.state(id);
    state.access = online.access;
    state.hasPin = !!online.hasPin;
    state.pin = null;
    this.remember(id);
  }

  error(id, message = '') {
    const state = this.state(id);
    state.error = message;
    state.conflictRevision = null;
    state.missing = false;
  }

  failed(id, error, suffix) {
    if (!this.lists[id]) return;
    if (error.code === 'LIST_DELETED') return this.markDeleted(id);
    this.error(id, error.message + suffix);
    const state = this.state(id);
    if (error.code === 'LIST_EXISTS') {
      state.publication = 'published';
      this.remember(id);
    }
    state.missing = error.code === 'LIST_NOT_FOUND';
    if (error.code === 'SYNC_CONFLICT' && isValidSyncToken(error.revision)) {
      state.conflictRevision = error.revision;
    }
  }

  checkSavedCopy(id) {
    if (serialize(this.storage.readLists()[id]) !== serialize(this.previous[id])) {
      throw new Error('This list changed in another tab. Reload to use the saved copy.');
    }
  }

  requireSaved(id) {
    this.checkSavedCopy(id);
    if (this.storageError || serialize(this.previous[id]) !== serialize(this.lists[id])) {
      throw new Error('Save on this device must succeed before syncing.');
    }
  }

  flush() {
    this.storageError = '';
    try {
      const disk = this.storage.readLists();
      for (const id of new Set([...Object.keys(this.previous), ...Object.keys(this.lists)])) {
        const list = this.lists[id];
        const current = serialize(list);
        const previous = serialize(this.previous[id]);
        if (current === previous) continue;
        const state = this.state(id);
        if (list !== undefined && !isValidList(list)) {
          state.ready = false;
          this.error(id, 'Invalid list data. The last saved copy has been kept.');
          continue;
        }
        if (serialize(disk[id]) !== previous && serialize(disk[id]) !== current) {
          state.ready = false;
          this.error(
            id,
            'This list changed in another tab. Your edits are still open here; copy them before reloading.',
          );
          continue;
        }
        if (list === undefined) {
          delete disk[id];
        } else {
          if (this.incoming.get(id) === current) this.incoming.delete(id);
          else state.pending = true;
          // Save the pending flag first so a refresh cannot discard an unsent edit.
          this.remember(id);
          disk[id] = list;
        }
        this.storage.writeLists(disk);
        if (list === undefined) {
          this.cancelTimer(id);
          this.requests.delete(id);
          this.incoming.delete(id);
          delete this.previous[id];
          delete this.statuses[id];
        } else {
          this.previous[id] = clone(list);
          this.queue(id);
        }
      }
      this.storageError = '';
    } catch (error) {
      this.storageError = 'Could not save on this device: ' + error.message;
    }
    this.reportStorageError(this.storageError);
  }

  cancelTimer(id) {
    this.scheduler.clear(this.timers.get(id));
    this.timers.delete(id);
  }

  queue(id) {
    this.cancelTimer(id);
    const state = this.statuses[id];
    const list = this.lists[id];
    if (
      !state ||
      state.deletion !== 'none' ||
      state.activity !== 'idle' ||
      !state.ready ||
      !state.pending ||
      !isValidList(list) ||
      !list[0].online ||
      this.storageError
    )
      return;
    this.timers.set(
      id,
      this.scheduler.set(() => this.upload(id), 700),
    );
  }

  begin(id, activity) {
    this.cancelTimer(id);
    const request = {};
    request.done = new Promise((resolve) => {
      request.complete = resolve;
    });
    this.requests.set(id, request);
    this.state(id).activity = activity;
    return request;
  }

  isCurrent(id, request) {
    return this.requests.get(id) === request && !!this.lists[id];
  }

  finish(id, request) {
    request.complete();
    if (!this.isCurrent(id, request)) return;
    this.requests.delete(id);
    this.state(id).activity = 'idle';
    this.queue(id);
  }

  async upload(id) {
    const state = this.state(id);
    const list = this.lists[id];
    if (
      state.deletion !== 'none' ||
      state.activity !== 'idle' ||
      !state.ready ||
      !isValidList(list) ||
      !list[0].online
    )
      return;
    const data = serialize(list);
    const request = this.begin(id, 'upload');
    try {
      this.requireSaved(id);
      // Save once and use the returned token; no preliminary or confirmation download.
      if (state.publication === 'local') state.publication = 'attempted';
      this.remember(id);
      const saved = await this.api.save(
        id,
        JSON.parse(data),
        state.publication === 'published' ? state.revision : null,
        state.access,
        state.pin || undefined,
      );
      request.access = saved.access;
      if (!this.isCurrent(id, request)) return;
      state.revision = saved.revision;
      state.publication = 'published';
      state.pending = serialize(this.lists[id]) !== data;
      this.rememberAccess(id, saved);
      this.error(id);
    } catch (error) {
      if (this.isCurrent(id, request)) {
        state.ready = false;
        this.failed(id, error, ' Sync is paused; your open list has been kept.');
      }
    } finally {
      this.finish(id, request);
    }
  }

  async load(id, replace = false) {
    const state = this.state(id);
    if (state.deletion !== 'none' || state.activity !== 'idle') return;
    const before = serialize(this.lists[id]);
    const request = this.begin(id, 'download');
    state.ready = false;
    try {
      this.checkSavedCopy(id);
      if (state.publication !== 'published') {
        state.ready = true;
        return;
      }
      const online = await this.api.read(id, state.revision, state.access);
      if (!this.isCurrent(id, request)) return;
      this.checkSavedCopy(id);
      this.rememberAccess(id, online);
      const local = this.lists[id];
      if (!local[0].online) return;
      const remote = serialize(online.list);
      const current = serialize(local);
      // An explicit reload must still preserve edits made during its request.
      if (current !== before || (state.pending && !replace)) {
        if (remote !== current && online.revision !== state.revision && remote !== before) {
          throw conflict(
            online.revision,
            'The online copy differs from your unsent edits. Choose which current copy to use.',
          );
        }
        state.pending = current !== remote;
      } else {
        state.pending = false;
        this.incoming.set(id, remote);
        this.lists[id] = online.list;
        this.flush();
      }
      state.revision = online.revision;
      this.remember(id);
      state.ready = true;
      this.error(id);
    } catch (error) {
      if (this.isCurrent(id, request)) this.failed(id, error, ' Your local copy has been kept.');
    } finally {
      this.finish(id, request);
    }
  }

  async import(id, pin = '') {
    const online = await this.api.join(id, pin);
    if (Object.hasOwn(this.lists, id)) return;
    online.list[0].online = true;
    const state = this.state(id);
    state.revision = online.revision;
    state.publication = 'published';
    state.ready = true;
    this.rememberAccess(id, online);
    this.incoming.set(id, serialize(online.list));
    this.lists[id] = online.list;
    this.flush();
  }

  publish(id) {
    const state = this.state(id);
    if (!state.missing || state.deletion !== 'none' || state.activity !== 'idle') return;
    state.revision = null;
    state.publication = 'local';
    state.pending = true;
    state.ready = true;
    this.remember(id);
    this.queue(id);
  }

  async resolve(id) {
    const state = this.state(id);
    if (!state.conflictRevision || state.deletion !== 'none' || state.activity !== 'idle') return;
    this.flush();
    const before = serialize(this.lists[id]);
    const request = this.begin(id, 'upload');
    state.ready = false;
    try {
      this.requireSaved(id);
      if (state.publication === 'local') state.publication = 'attempted';
      this.remember(id);
      const saved = await this.api.save(
        id,
        JSON.parse(before),
        state.conflictRevision,
        state.access,
      );
      if (!this.isCurrent(id, request)) return;
      this.checkSavedCopy(id);
      state.revision = saved.revision;
      state.publication = 'published';
      if (serialize(this.lists[id]) === before && this.lists[id][0].online) {
        this.incoming.set(id, serialize(saved.list));
        this.lists[id] = saved.list;
      }
      state.pending = serialize(this.lists[id]) !== serialize(saved.list);
      this.rememberAccess(id, saved);
      this.flush();
      this.error(id);
      state.ready = true;
    } catch (error) {
      if (this.isCurrent(id, request)) this.failed(id, error, ' Your local copy has been kept.');
    } finally {
      this.finish(id, request);
    }
  }

  markDeleted(id) {
    const state = this.state(id);
    state.deletion = 'deleted';
    state.ready = false;
    this.cancelTimer(id);
    this.error(id, 'The online list was deleted. This copy is now local only.');
    try {
      this.remember(id);
      if (this.lists[id]) this.lists[id][0].online = false;
      this.flush();
    } catch (error) {
      this.storageError = 'Could not save on this device: ' + error.message;
      this.reportStorageError(this.storageError);
    }
  }

  async remove(id) {
    const state = this.state(id);
    if (!this.lists[id] || state.activity === 'delete') return;
    this.flush();
    const before = serialize(this.lists[id]);
    const remote = hasRemoteCopy(state, this.lists[id]);
    const creation =
      state.publication === 'attempted' && state.activity === 'upload'
        ? this.requests.get(id)
        : null;
    // A delete supersedes any outstanding read/upload; its late result is ignored.
    const request = this.begin(id, 'delete');
    state.ready = false;
    try {
      this.requireSaved(id);
      if (remote) {
        state.deletion = 'pending';
        this.remember(id);
        this.error(id, 'Deleting the online list…');
        // Let the first insert finish before deleting its record.
        if (creation) await creation.done;
        if (!this.isCurrent(id, request)) return;
        if (creation?.access) {
          state.access = creation.access;
          state.pin = null;
          this.remember(id);
        }
        await this.api.remove(id, state.access);
        if (!this.isCurrent(id, request)) return;
        state.deletion = 'deleted';
        this.remember(id);
      }
      this.checkSavedCopy(id);
      if (serialize(this.lists[id]) !== before) {
        this.markDeleted(id);
        this.error(
          id,
          'The online list was deleted. Edits made during deletion were kept locally.',
        );
        return;
      }
      delete this.lists[id];
      this.flush();
    } catch (error) {
      this.error(id, error.message + ' Your local copy has been kept. Retry delete to finish.');
    } finally {
      this.finish(id, request);
    }
  }

  nextId() {
    return newListId(new Set([...this.storage.usedIds(), ...Object.keys(this.lists)]), this.random);
  }

  shareAgain(id, pin) {
    const state = this.state(id);
    if (state.deletion !== 'deleted' || !isValidList(this.lists[id])) return;
    try {
      this.flush();
      this.requireSaved(id);
      const newId = this.nextId();
      const list = clone(this.lists[id]);
      list[0].online = true;
      const next = this.state(newId);
      next.publication = 'local';
      next.pin = pin;
      next.ready = true;
      this.lists[newId] = list;
      this.flush();
      if (this.storageError || serialize(this.storage.readLists()[newId]) !== serialize(list))
        return;
      // Store the complete new copy before removing the old ID.
      delete this.lists[id];
      this.flush();
      return newId;
    } catch (error) {
      this.error(id, error.message + ' Your local copy has been kept.');
    }
  }

  toggle(id) {
    const state = this.state(id);
    if (state.deletion !== 'none') return;
    const list = this.lists[id];
    list[0].online = !list[0].online;
    if (list[0].online) state.ready = state.publication !== 'published';
    this.flush();
    if (list[0].online && !state.ready) this.load(id);
  }

  async setPin(id, pin) {
    const state = this.state(id);
    if (state.activity !== 'idle' || state.publication !== 'published' || state.deletion !== 'none')
      return;
    const request = this.begin(id, 'pin');
    try {
      const saved = await this.api.setPin(id, pin, state.access);
      if (!this.isCurrent(id, request)) return;
      this.rememberAccess(id, saved);
      this.error(id);
    } catch (error) {
      if (this.isCurrent(id, request)) this.failed(id, error, ' The PIN was not confirmed.');
    } finally {
      this.finish(id, request);
    }
  }

  async authorize(id, pin) {
    const state = this.state(id);
    if (state.activity !== 'idle' || !this.lists[id]) return;
    const request = this.begin(id, 'download');
    try {
      const online = await this.api.join(id, pin);
      if (!this.isCurrent(id, request)) return;
      state.publication = 'published';
      state.revision ||= online.revision;
      this.rememberAccess(id, online);
      state.ready = true;
      this.error(id);
    } catch (error) {
      if (this.isCurrent(id, request)) this.failed(id, error, ' Your local copy has been kept.');
    } finally {
      this.finish(id, request);
    }
  }

  refresh() {
    for (const [id, list] of Object.entries(this.lists)) {
      if (isValidList(list) && list[0].online) this.load(id);
    }
  }

  dispose() {
    this.flush();
    for (const id of this.timers.keys()) this.cancelTimer(id);
    this.requests.clear();
  }
}

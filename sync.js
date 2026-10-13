const SYNC_STORAGE_KEY = 'liststorage:sync';
const BACKUP_STORAGE_KEY = 'liststorage:backups';
const serialize = value => JSON.stringify(value);

// Even a list with no tasks has a title/metadata entry at index zero.
function isValidList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item =>
    item && typeof item === 'object' && !Array.isArray(item) &&
    typeof item.title === 'string' &&
    (item.done === undefined || typeof item.done === 'boolean') &&
    (item.online === undefined || typeof item.online === 'boolean') &&
    (item.bg === undefined || typeof item.bg === 'string'));
}

function readStorage(key) {
  const value = JSON.parse(localStorage.getItem(key) || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid saved list data. Your stored data has not been replaced.');
  }
  return value;
}

const liststorage = {
  fetch: () => readStorage('liststorage'),
  save: lists => localStorage.setItem('liststorage', serialize(lists))
};

function newListId(lists) {
  const used = { ...readStorage(SYNC_STORAGE_KEY), ...liststorage.fetch(), ...lists };
  let id;
  do {
    id = Array.from(crypto.getRandomValues(new Uint8Array(6)), value => (value & 31).toString(32)).join('');
  } while (Object.prototype.hasOwnProperty.call(used, id));
  return id;
}

function onlineUrl(id, known = []) {
  const configured = (window.FLIPPYLIST_CONFIG && window.FLIPPYLIST_CONFIG.apiBaseUrl || '').trim();
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  let base = '';
  if (configured) {
    const url = new URL(configured);
    const localApi = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(localApi && url.protocol === 'http:')) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Set apiBaseUrl in config.js to the HTTPS origin of the API, without /api/list.');
    }
    base = url.origin;
  } else if (!isLocal) {
    throw new Error('Online sync is not configured yet. Set apiBaseUrl in config.js to the Vercel API address.');
  }
  return base + '/api/list?id=' + encodeURIComponent(id) +
    (known.length ? '&known=' + encodeURIComponent(serialize(known)) : '');
}

async function onlineResponse(response, action, deletion = false) {
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || action + ' failed (HTTP ' + response.status + ').');
    error.code = data.code;
    error.revision = data.revision;
    error.versions = data.versions;
    throw error;
  }
  if (deletion) {
    if (data.deleted !== true) throw new Error('The server did not confirm deletion. Retry delete.');
    return data;
  }
  if (!isValidList(data.list) || !Array.isArray(data.revision) || data.revision.length !== 1 ||
      !data.revision.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('The server returned an empty or invalid list.');
  }
  return data;
}

async function getOnline(id, known = []) {
  const response = await fetch(onlineUrl(id, known), {
    cache: 'no-store',
    credentials: 'omit'
  });
  return onlineResponse(response, 'Download');
}

async function saveOnline(id, data, revision) {
  const response = await fetch(onlineUrl(id), {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: serialize({ list: JSON.parse(data), revision })
  });
  return onlineResponse(response, 'Upload');
}

async function deleteOnline(id) {
  return onlineResponse(await fetch(onlineUrl(id), {
    method: 'DELETE', credentials: 'omit', headers: { 'Accept': 'application/json' }
  }), 'Delete', true);
}

class ListSync {
  constructor(app) {
    this.app = app;
    this.previous = JSON.parse(serialize(app.lists));
    this.metadata = readStorage(SYNC_STORAGE_KEY);
    this.states = new Map();
    Object.keys(app.lists).forEach(id => this.state(id));
  }

  state(id) {
    if (!this.states.has(id)) {
      const saved = this.metadata[id] || {};
      this.states.set(id, {
        baseline: saved.baseline || serialize(this.app.lists[id]),
        pending: !!saved.pending,
        revision: Array.isArray(saved.revision) ? saved.revision : [],
        unpublished: saved.unpublished === undefined
          ? !(this.app.lists[id] && this.app.lists[id][0].online)
          : saved.unpublished,
        attempted: !!saved.attempted,
        deleted: !!saved.deleted,
        deletePending: !!saved.deletePending,
        deleting: false,
        ready: false,
        loading: false,
        saving: false,
        timer: null,
        incoming: null
      });
      if (saved.deletePending) {
        Vue.set(this.app.deletePending, id, true);
        this.error(id, 'Deletion is not finished. Retry delete; your local copy has been kept.');
      } else if (saved.deleted) {
        Vue.set(this.app.deletedOnline, id, true);
        this.error(id, 'The online list was deleted. This copy is now local only.');
      }
    }
    return this.states.get(id);
  }

  error(id, message) {
    Vue.set(this.app.syncErrors, id, message);
    if (!message) {
      Vue.delete(this.app.syncConflicts, id);
      Vue.delete(this.app.missingOnline, id);
    }
  }

  failed(id, error, suffix) {
    if (!this.app.lists[id]) return;
    if (error.code === 'LIST_DELETED') {
      this.markDeleted(id);
      return;
    }
    this.error(id, error.message + suffix);
    Vue.set(this.app.missingOnline, id, error.code === 'LIST_NOT_FOUND');
    Vue.delete(this.app.syncConflicts, id);
    if (error.code === 'SYNC_CONFLICT' && Array.isArray(error.revision) &&
        Array.isArray(error.versions) && error.versions.every(version => isValidList(version.list))) {
      Vue.set(this.app.syncConflicts, id, { revision: error.revision, versions: error.versions });
    }
  }

  checkSavedCopy(id) {
    if (serialize(liststorage.fetch()[id]) !== serialize(this.previous[id])) {
      throw new Error('This list changed in another tab. Reload to use the saved copy.');
    }
  }

  remember(id) {
    // Merge individual entries so a different tab's unrelated lists survive.
    const metadata = readStorage(SYNC_STORAGE_KEY);
    const state = this.state(id);
    metadata[id] = { baseline: state.baseline, pending: state.pending, unpublished: state.unpublished,
      revision: state.revision, attempted: state.attempted, deleted: state.deleted, deletePending: state.deletePending };
    localStorage.setItem(SYNC_STORAGE_KEY, serialize(metadata));
  }

  backup(id, list, reason) {
    if (!isValidList(list)) return;
    const backups = readStorage(BACKUP_STORAGE_KEY);
    const history = backups[id] || [];
    if (!history.length || serialize(history[history.length - 1].list) !== serialize(list)) {
      history.push({ savedAt: new Date().toISOString(), reason, list });
    }
    backups[id] = history.slice(-10);
    localStorage.setItem(BACKUP_STORAGE_KEY, serialize(backups));
  }

  changed() {
    try {
      const lists = this.app.lists;
      const disk = liststorage.fetch();
      const ids = new Set([...Object.keys(this.previous), ...Object.keys(lists)]);
      for (const id of ids) {
        const current = serialize(lists[id]);
        const previous = serialize(this.previous[id]);
        if (current === previous) continue;
        const state = this.state(id);
        if (lists[id] !== undefined && !isValidList(lists[id])) {
          state.ready = false;
          this.error(id, 'Invalid list data. The last saved copy has been kept.');
          continue;
        }
        if (serialize(disk[id]) !== previous && serialize(disk[id]) !== current) {
          state.ready = false;
          this.backup(id, lists[id], 'Edits conflicting with another tab');
          this.error(id, 'This list changed in another tab. Your edits are in the recovery backup. Reload to use the saved copy.');
          continue;
        }
        if (lists[id] === undefined) {
          this.backup(id, disk[id], 'List removed from this device');
          clearTimeout(state.timer);
          this.states.delete(id);
          delete disk[id];
        } else {
          if (state.incoming === current) {
            state.incoming = null;
          } else {
            state.pending = true;
          }
          // Persist pending status first: reloading must not discard an unsent edit.
          this.remember(id);
          disk[id] = lists[id];
        }
        liststorage.save(disk);
        if (lists[id] === undefined) delete this.previous[id];
        else this.previous[id] = JSON.parse(current);
        this.queue(id);
      }
      this.app.storageError = '';
    } catch (error) {
      this.app.storageError = 'Could not save on this device: ' + error.message;
    }
  }

  queue(id) {
    const state = this.states.get(id);
    if (!state) return;
    clearTimeout(state.timer);
    const list = this.app.lists[id];
    if (state.deleted || state.deletePending || !isValidList(list) || !list[0].online || !state.pending ||
        !state.ready || state.loading || state.saving || this.app.storageError) return;
    state.timer = setTimeout(() => this.upload(id), 700);
  }

  async upload(id) {
    const state = this.state(id);
    const list = this.app.lists[id];
    if (state.deleted || state.deletePending || !state.ready || state.loading || state.saving || !isValidList(list) || !list[0].online) return;
    const data = serialize(list);
    state.saving = true;
    try {
      this.checkSavedCopy(id);
      if (this.app.storageError || serialize(this.previous[id]) !== data) {
        throw new Error('Save on this device must succeed before uploading.');
      }
      if (!state.unpublished && data === state.baseline) {
        state.pending = false;
        this.remember(id);
        return;
      }
      if (!state.unpublished) {
        const online = await getOnline(id, state.revision);
        const remote = serialize(online.list);
        if (remote !== state.baseline && remote !== data) {
          throw new Error('The online list changed on another device. Load its copy before syncing further edits.');
        }
        if (this.states.get(id) !== state || state.deletePending || state.deleted || !this.app.lists[id] || !this.app.lists[id][0].online) return;
        this.checkSavedCopy(id);
        state.revision = online.revision;
      }
      state.attempted = true;
      this.remember(id);
      const saved = await saveOnline(id, data, state.unpublished ? [] : state.revision);
      if (this.states.get(id) !== state || state.deletePending || state.deleted) return;
      state.baseline = serialize(saved.list);
      state.revision = saved.revision;
      state.unpublished = false;
      state.pending = serialize(this.app.lists[id]) !== data;
      this.remember(id);
      this.error(id, '');
    } catch (error) {
      state.ready = false;
      if (this.states.get(id) === state && !state.deletePending && !state.deleted) {
        this.failed(id, error, ' Sync is paused; your open list has been kept.');
      }
    } finally {
      state.saving = false;
      if (this.states.get(id) === state) this.queue(id);
    }
  }

  async load(id, replace = false) {
    const state = this.state(id);
    if (state.deleted || state.deletePending || state.loading || state.saving) return;
    const before = serialize(this.app.lists[id]);
    state.loading = true;
    state.ready = false;
    clearTimeout(state.timer);
    try {
      this.checkSavedCopy(id);
      if (state.unpublished) {
        state.ready = true;
        return;
      }
      const online = await getOnline(id, state.revision);
      const data = online.list;
      if (this.states.get(id) !== state || state.deletePending || state.deleted) return;
      this.checkSavedCopy(id);
      const local = this.app.lists[id];
      if (!local || !local[0].online) return;
      const remote = serialize(data);
      const current = serialize(local);
      // Never overwrite edits made while a download was in flight, even on an explicit reload.
      if (current !== before || (state.pending && !replace)) {
        if (remote !== current && remote !== state.baseline) {
          throw new Error('The online copy differs from your unsent edits. Sync is paused.');
        }
        state.baseline = remote;
        state.pending = current !== remote;
      } else {
        if (!replace && data.length === 1 && local.length > 1) {
          throw new Error('The online copy has no items. Your local items have been kept.');
        }
        if (current !== remote) this.backup(id, local, 'Before downloading an online copy');
        state.baseline = remote;
        state.revision = online.revision;
        state.pending = false;
        state.incoming = remote;
        Vue.set(this.app.lists, id, data);
        this.changed();
      }
      state.revision = online.revision;
      this.remember(id);
      state.ready = true;
      this.error(id, '');
    } catch (error) {
      if (this.states.get(id) === state && !state.deletePending && !state.deleted) {
        this.failed(id, error, ' Your local copy has been kept.');
      }
    } finally {
      state.loading = false;
      this.queue(id);
    }
  }

  async import(id) {
    const online = await getOnline(id);
    const data = online.list;
    if (Object.prototype.hasOwnProperty.call(this.app.lists, id)) return;
    data[0].online = true;
    const state = this.state(id);
    state.baseline = serialize(data);
    state.revision = online.revision;
    state.unpublished = false;
    state.incoming = state.baseline;
    state.ready = true;
    Vue.set(this.app.lists, id, data);
    this.changed();
  }

  publish(id) {
    if (!this.app.missingOnline[id]) return;
    const state = this.state(id);
    if (state.deleted || state.deletePending || state.saving || state.loading) return;
    state.revision = [];
    state.unpublished = true;
    state.pending = true;
    state.ready = true;
    this.remember(id);
    this.queue(id);
  }

  async resolve(id, version) {
    const conflict = this.app.syncConflicts[id];
    const state = this.state(id);
    if (!conflict || state.deleted || state.deletePending || state.saving || state.loading) return;
    this.changed();
    const before = serialize(this.app.lists[id]);
    const chosen = serialize(version ? version.list : this.app.lists[id]);
    state.saving = true;
    state.ready = false;
    clearTimeout(state.timer);
    try {
      this.checkSavedCopy(id);
      if (this.app.storageError) throw new Error('Save on this device must succeed before resolving.');
      this.backup(id, this.app.lists[id], 'Before choosing a saved version');
      state.attempted = true;
      this.remember(id);
      const saved = await saveOnline(id, chosen, conflict.revision);
      if (this.states.get(id) !== state || state.deletePending || state.deleted) return;
      this.checkSavedCopy(id);
      state.baseline = serialize(saved.list);
      state.revision = saved.revision;
      state.unpublished = false;
      if (serialize(this.app.lists[id]) === before && this.app.lists[id][0].online) {
        state.incoming = state.baseline;
        Vue.set(this.app.lists, id, saved.list);
      }
      state.pending = serialize(this.app.lists[id]) !== state.baseline;
      this.remember(id);
      this.changed();
      this.error(id, '');
      state.ready = true;
    } catch (error) {
      if (this.states.get(id) === state && !state.deletePending && !state.deleted) {
        this.failed(id, error, ' Your local copy has been kept.');
      }
    } finally {
      state.saving = false;
      if (this.states.get(id) === state) this.queue(id);
    }
  }

  markDeleted(id) {
    const state = this.state(id);
    state.deleted = true;
    state.ready = false;
    clearTimeout(state.timer);
    Vue.set(this.app.deletedOnline, id, true);
    Vue.delete(this.app.missingOnline, id);
    Vue.delete(this.app.syncConflicts, id);
    this.error(id, 'The online list was deleted. This copy is now local only.');
    // Persist the terminal state before changing the local online setting.
    try {
      this.remember(id);
      if (this.app.lists[id]) Vue.set(this.app.lists[id][0], 'online', false);
      this.changed();
    } catch (error) {
      this.app.storageError = 'Could not save on this device: ' + error.message;
    }
  }

  async remove(id) {
    const state = this.state(id);
    if (!this.app.lists[id] || state.deleting) return;
    this.changed();
    const before = serialize(this.app.lists[id]);
    const remote = state.deletePending || !state.unpublished || state.attempted || this.app.lists[id][0].online;
    state.ready = false;
    clearTimeout(state.timer);
    try {
      this.checkSavedCopy(id);
      if (this.app.storageError) throw new Error('Save on this device must succeed before deleting.');
      this.backup(id, this.app.lists[id], 'Before deleting this list');
      if (remote) {
        state.deletePending = true;
        this.remember(id);
        state.deleting = true;
        Vue.set(this.app.deletePending, id, true);
        Vue.set(this.app.deletingLists, id, true);
        this.error(id, 'Deleting the online list and its history…');
        await deleteOnline(id);
        state.deletePending = false;
        Vue.delete(this.app.deletePending, id);
        state.deleted = true;
        this.remember(id);
      }
      this.checkSavedCopy(id);
      // Keep edits made while the request was pending; only remove the copy
      // whose contents the user actually confirmed deleting.
      if (serialize(this.app.lists[id]) !== before) {
        this.markDeleted(id);
        this.error(id, 'The online list was deleted. Edits made during deletion were kept locally.');
        return;
      }
      Vue.delete(this.app.lists, id);
      this.changed();
      this.error(id, '');
    } catch (error) {
      this.error(id, error.message + ' Your local copy has been kept. Retry delete to finish.');
    } finally {
      state.deleting = false;
      Vue.delete(this.app.deletingLists, id);
    }
  }

  shareAgain(id) {
    const state = this.state(id);
    if (!state.deleted || state.deletePending || !isValidList(this.app.lists[id])) return;
    try {
      this.changed();
      this.checkSavedCopy(id);
      if (this.app.storageError) throw new Error('Save on this device must succeed before sharing.');
      const newId = newListId(this.app.lists);
      const list = JSON.parse(serialize(this.app.lists[id]));
      list[0].online = true;
      const next = this.state(newId);
      next.unpublished = true;
      next.ready = true;
      Vue.set(this.app.lists, newId, list);
      this.changed();
      if (this.app.storageError || serialize(liststorage.fetch()[newId]) !== serialize(list)) return;
      // The complete new copy is safely stored before removing the old ID.
      Vue.delete(this.app.lists, id);
      this.changed();
      return newId;
    } catch (error) {
      this.error(id, error.message + ' Your local copy has been kept.');
    }
  }

  toggle(id) {
    const list = this.app.lists[id];
    const state = this.state(id);
    if (state.deletePending) return;
    if (state.deleted) return this.app.shareAgain(id);
    Vue.set(list[0], 'online', !list[0].online);
    // New local lists can be published; existing online lists are checked before reconnecting.
    const baseline = state.baseline && JSON.parse(state.baseline);
    if (list[0].online && (!baseline || !baseline[0].online)) state.ready = true;
    this.changed();
    if (list[0].online && !state.ready) this.load(id);
  }
}

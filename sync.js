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

async function onlineResponse(response, action) {
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || action + ' failed (HTTP ' + response.status + ').');
    error.code = data.code;
    error.revision = data.revision;
    error.versions = data.versions;
    throw error;
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
        ready: false,
        loading: false,
        saving: false,
        timer: null,
        incoming: null
      });
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
    metadata[id] = { baseline: state.baseline, pending: state.pending, unpublished: state.unpublished, revision: state.revision };
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
    if (!isValidList(list) || !list[0].online || !state.pending ||
        !state.ready || state.loading || state.saving || this.app.storageError) return;
    state.timer = setTimeout(() => this.upload(id), 700);
  }

  async upload(id) {
    const state = this.state(id);
    const list = this.app.lists[id];
    if (!state.ready || state.loading || state.saving || !isValidList(list) || !list[0].online) return;
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
        if (this.states.get(id) !== state || !this.app.lists[id] || !this.app.lists[id][0].online) return;
        this.checkSavedCopy(id);
        state.revision = online.revision;
      }
      const saved = await saveOnline(id, data, state.unpublished ? [] : state.revision);
      if (this.states.get(id) !== state) return;
      state.baseline = serialize(saved.list);
      state.revision = saved.revision;
      state.unpublished = false;
      state.pending = serialize(this.app.lists[id]) !== data;
      this.remember(id);
      this.error(id, '');
    } catch (error) {
      state.ready = false;
      this.failed(id, error, ' Sync is paused; your open list has been kept.');
    } finally {
      state.saving = false;
      if (this.states.get(id) === state) this.queue(id);
    }
  }

  async load(id, replace = false) {
    const state = this.state(id);
    if (state.loading || state.saving) return;
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
      if (this.states.get(id) !== state) return;
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
      this.failed(id, error, ' Your local copy has been kept.');
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
    if (state.saving || state.loading) return;
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
    if (!conflict || state.saving || state.loading) return;
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
      const saved = await saveOnline(id, chosen, conflict.revision);
      if (this.states.get(id) !== state) return;
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
      this.failed(id, error, ' Your local copy has been kept.');
    } finally {
      state.saving = false;
      if (this.states.get(id) === state) this.queue(id);
    }
  }

  toggle(id) {
    const list = this.app.lists[id];
    const state = this.state(id);
    Vue.set(list[0], 'online', !list[0].online);
    // New local lists can be published; existing online lists are checked before reconnecting.
    const baseline = state.baseline && JSON.parse(state.baseline);
    if (list[0].online && (!baseline || !baseline[0].online)) state.ready = true;
    this.changed();
    if (list[0].online && !state.ready) this.load(id);
  }
}

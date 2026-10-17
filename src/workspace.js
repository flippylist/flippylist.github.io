import { reactive, ref, watch } from 'vue';
import { createList, isTaskIndex, isValidList } from './domain/lists.js';
import { createStorage } from './services/storage.js';
import { ListSync } from './sync/controller.js';
import { hasRemoteCopy } from './sync/state.js';

export function createWorkspace({ storage, api, dialogs, scheduler, random }) {
  const repository = createStorage(storage);
  const lists = reactive(repository.readLists());
  const statuses = reactive({});
  const storageError = ref('');
  const sync = new ListSync({
    lists,
    statuses,
    storage: repository,
    api,
    scheduler,
    random,
    reportStorageError: (message) => {
      storageError.value = message;
    },
  });
  const stopWatching = watch(lists, () => sync.flush(), { deep: true });

  function askPin(message, allowEmpty = false) {
    const answer = dialogs.prompt(message);
    if (answer === null) return null;
    const pin = answer.trim();
    if (!/^\d{6}$/.test(pin) && !(allowEmpty && !pin)) {
      dialogs.alert('Please enter a six-digit PIN.');
      return null;
    }
    return pin;
  }

  const actions = {
    async addList() {
      const answer = dialogs.prompt('Enter id or leave blank for new list');
      if (answer === null) return;
      const id = answer.trim() || sync.nextId();
      if (['__proto__', 'constructor', 'prototype'].includes(id) || Object.hasOwn(lists, id)) {
        dialogs.alert('That list id is already in use or is invalid.');
        return;
      }
      if (answer.trim()) {
        const pin = askPin('Enter the list PIN (leave blank for a list without a PIN)', true);
        if (pin === null) return;
        try {
          await sync.import(id, pin);
        } catch (error) {
          dialogs.alert('Could not open the list: ' + error.message);
        }
      } else {
        lists[id] = createList();
      }
    },
    editTitle(id, title) {
      lists[id][0].title = title;
    },
    editColor(id, bg) {
      lists[id][0].bg = bg;
    },
    editItem(id, index, title) {
      if (isTaskIndex(lists[id], index)) lists[id][index].title = title;
    },
    setDone(id, index, done) {
      if (isTaskIndex(lists[id], index)) lists[id][index].done = done;
    },
    addItem(id, title) {
      if (title && isValidList(lists[id])) lists[id].push({ title, done: false });
    },
    removeItem(id, index) {
      if (isTaskIndex(lists[id], index)) lists[id].splice(index, 1);
    },
    moveItem(id, from, to) {
      const list = lists[id];
      if (isTaskIndex(list, from) && isTaskIndex(list, to)) {
        list.splice(to, 0, list.splice(from, 1)[0]);
      }
    },
    toggleOnline(id) {
      if (sync.state(id).deletion === 'deleted') return actions.shareAgain(id);
      if (!lists[id][0].online && sync.state(id).publication === 'local' && !sync.state(id).pin) {
        const pin = askPin('Choose a six-digit PIN for adding this list on other devices');
        if (pin === null) return;
        sync.state(id).pin = pin;
      }
      sync.toggle(id);
    },
    setPin(id) {
      const state = sync.state(id);
      const pin = askPin(
        state.access
          ? 'Choose a six-digit PIN for adding this list on other devices'
          : 'Enter the list PIN (leave blank for a list without a PIN)',
        !state.access,
      );
      if (pin === null) return;
      return state.access ? sync.setPin(id, pin) : sync.authorize(id, pin);
    },
    retrySync: (id) => sync.load(id),
    publishList(id) {
      if (
        dialogs.confirm(
          'Publish this device’s copy online? Check that it contains the items you want to keep.',
        )
      ) {
        const pin = askPin('Choose a six-digit PIN for adding this list on other devices');
        if (pin === null) return;
        sync.state(id).pin = pin;
        sync.publish(id);
      }
    },
    resolveList(id) {
      if (
        dialogs.confirm(
          'Replace the online list with this device’s current copy? This cannot be undone.',
        )
      ) {
        return sync.resolve(id);
      }
    },
    loadOnlineCopy(id) {
      if (
        dialogs.confirm(
          'Replace this device’s list with the online copy? Your unsent edits will be lost.',
        )
      ) {
        return sync.load(id, true);
      }
    },
    removeList(id) {
      if (!lists[id] || sync.state(id).activity === 'delete') return;
      const message = hasRemoteCopy(sync.state(id), lists[id])
        ? 'Delete this list from this device and delete its online copy? Other devices keep their own copies but can no longer sync this ID.'
        : 'Delete this local list?';
      if (dialogs.confirm(message)) return sync.remove(id);
    },
    shareAgain(id) {
      if (
        dialogs.confirm(
          'Share this copy with a new six-character ID? Other devices will need the new ID to sync with it.',
        )
      ) {
        const pin = askPin('Choose a six-digit PIN for adding this list on other devices');
        if (pin === null) return;
        return sync.shareAgain(id, pin);
      }
    },
  };

  return {
    lists,
    statuses,
    storageError,
    actions,
    sync,
    connect(target) {
      const refresh = () => sync.refresh();
      const flush = () => sync.flush();
      target.addEventListener('pagehide', flush);
      target.addEventListener('focus', refresh);
      target.addEventListener('online', refresh);
      refresh();
      return () => {
        target.removeEventListener('pagehide', flush);
        target.removeEventListener('focus', refresh);
        target.removeEventListener('online', refresh);
      };
    },
    dispose() {
      stopWatching();
      sync.dispose();
    },
  };
}

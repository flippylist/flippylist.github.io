import { isValidList, isValidSyncToken, serialize } from '../domain/lists.js';

const LISTS_KEY = 'liststorage';
const SYNC_KEY = 'liststorage:sync';

export function createStorage(storage) {
  function read(key) {
    const value = JSON.parse(storage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid saved list data. Your stored data has not been replaced.');
    }
    return value;
  }

  function readMetadata() {
    return Object.fromEntries(
      Object.entries(read(SYNC_KEY)).map(([id, value]) => [
        id,
        {
          revision: isValidSyncToken(value?.revision) ? value.revision : null,
          access: /^[A-Za-z0-9_-]{43}$/.test(value?.access || '') ? value.access : null,
          pin: /^\d{6}$/.test(value?.pin || '') ? value.pin : null,
          hasPin: !!value?.hasPin,
          pending: !!value?.pending,
          unpublished: value?.unpublished,
          attempted: !!value?.attempted,
          deleted: !!value?.deleted,
          deletePending: !!value?.deletePending,
        },
      ]),
    );
  }

  return {
    readLists() {
      const lists = read(LISTS_KEY);
      if (Object.values(lists).some((list) => !isValidList(list))) {
        throw new Error('Invalid saved list data. Your stored data has not been replaced.');
      }
      return lists;
    },
    writeLists(lists) {
      storage.setItem(LISTS_KEY, serialize(lists));
    },
    readMetadata,
    initialize() {
      // Remove the retired recovery feature; never copy or restore past contents.
      storage.removeItem('liststorage:backups');
      const metadata = readMetadata();
      storage.setItem(SYNC_KEY, serialize(metadata));
      return metadata;
    },
    writeMetadata(id, value) {
      // Merge one entry so another tab's unrelated lists survive.
      const metadata = readMetadata();
      metadata[id] = value;
      storage.setItem(SYNC_KEY, serialize(metadata));
    },
    usedIds() {
      return new Set([...Object.keys(read(LISTS_KEY)), ...Object.keys(readMetadata())]);
    },
  };
}

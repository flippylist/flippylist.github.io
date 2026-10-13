// The first array entry is list metadata. This is also the storage/API format.
export const serialize = (value) => JSON.stringify(value);
export const clone = (value) => JSON.parse(serialize(value));

export function isValidList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.title === 'string' &&
        (item.done === undefined || typeof item.done === 'boolean') &&
        (item.online === undefined || typeof item.online === 'boolean') &&
        (item.bg === undefined || typeof item.bg === 'string'),
    )
  );
}

export function isValidSyncToken(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,14}-[a-f0-9]{64}$/.test(value);
}

export function newListId(usedIds, random = (bytes) => crypto.getRandomValues(bytes)) {
  let id;
  do {
    id = Array.from(random(new Uint8Array(6)), (value) => (value & 31).toString(32)).join('');
  } while (usedIds.has(id));
  return id;
}

export const createList = () => [{ title: '...', bg: '', online: false }];
export const isTaskIndex = (list, index) =>
  !!list && Number.isInteger(index) && index > 0 && index < list.length;

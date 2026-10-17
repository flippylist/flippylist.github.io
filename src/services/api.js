import { isValidList, isValidSyncToken } from '../domain/lists.js';

const isLocal = (host) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

function apiOrigin(baseUrl, hostname) {
  const configured = baseUrl.trim();
  if (!configured) {
    if (isLocal(hostname)) return '';
    throw new Error('Online sync is not configured. Set VITE_API_BASE_URL and rebuild the app.');
  }
  const url = new URL(configured);
  if (
    (url.protocol !== 'https:' && !(isLocal(url.hostname) && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Set VITE_API_BASE_URL to the HTTPS origin of the API, without /api/list.');
  }
  return url.origin;
}

export function createApi({ baseUrl, hostname, fetch: fetchRequest = globalThis.fetch }) {
  async function request(id, { method = 'GET', revision = null, list, access, pin, action } = {}) {
    const query = new URLSearchParams({ id });
    if (method === 'GET' && revision) query.set('known', revision);
    const path = action === 'join' ? '/api/join' : `/api/list?${query}`;
    const response = await fetchRequest(`${apiOrigin(baseUrl, hostname)}${path}`, {
      method,
      credentials: 'omit',
      headers: {
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...(method === 'POST'
          ? { Accept: 'application/json', 'Content-Type': 'application/json' }
          : {}),
      },
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
      ...(method === 'POST'
        ? {
            body: JSON.stringify(action === 'join' ? { id, pin } : { list, revision, pin, action }),
          }
        : {}),
    });
    if (response.status === 429) {
      throw new Error('Too many attempts. Try again in a minute.');
    }
    const data = await response.json();
    if (!response.ok) {
      const action = { GET: 'Download', POST: 'Upload', DELETE: 'Delete' }[method];
      throw Object.assign(new Error(data?.error || `${action} failed (HTTP ${response.status}).`), {
        code: data?.code,
        revision: data?.revision,
      });
    }
    if (method === 'DELETE') {
      if (data?.deleted !== true)
        throw new Error('The server did not confirm deletion. Retry delete.');
    } else if (
      !isValidList(data?.list) ||
      !isValidSyncToken(data?.revision) ||
      !/^[A-Za-z0-9_-]{43}$/.test(data?.access || '')
    ) {
      throw new Error('The server returned an empty or invalid list.');
    }
    return data;
  }
  return {
    read: (id, revision = null, access) => request(id, { revision, access }),
    join: (id, pin) => request(id, { method: 'POST', action: 'join', pin }),
    save: (id, list, revision, access, pin) =>
      request(id, { method: 'POST', list, revision, access, pin }),
    remove: (id, access) => request(id, { method: 'DELETE', access }),
    setPin: (id, pin, access) => request(id, { method: 'POST', action: 'pin', pin, access }),
  };
}

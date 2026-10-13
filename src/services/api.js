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
  async function request(id, { method = 'GET', revision = null, list } = {}) {
    const query = new URLSearchParams({ id });
    if (method === 'GET' && revision) query.set('known', revision);
    const response = await fetchRequest(`${apiOrigin(baseUrl, hostname)}/api/list?${query}`, {
      method,
      credentials: 'omit',
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
      ...(method === 'POST'
        ? {
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ list, revision }),
          }
        : {}),
    });
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
    } else if (!isValidList(data?.list) || !isValidSyncToken(data?.revision)) {
      throw new Error('The server returned an empty or invalid list.');
    }
    return data;
  }
  return {
    read: (id, revision = null) => request(id, { revision }),
    save: (id, list, revision) => request(id, { method: 'POST', list, revision }),
    remove: (id) => request(id, { method: 'DELETE' }),
  };
}

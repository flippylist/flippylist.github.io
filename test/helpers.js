import crypto from 'node:crypto';
import { nextTick } from 'vue';
import { createApi } from '../src/services/api.js';
import { createWorkspace } from '../src/workspace.js';

export const copy = (value) => JSON.parse(JSON.stringify(value));
export const list = (...titles) => [
  { title: 'Shopping', bg: '', online: true },
  ...titles.map((title) => ({ title, done: false })),
];
export const token = (data, version = 1) =>
  version + '-' + crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

export function browser(lists = { shared: list('Milk') }, extraStorage = {}, options = {}) {
  const storage = new Map(Object.entries({ liststorage: JSON.stringify(lists), ...extraStorage }));
  const requests = [];
  const serverData = new Map(Object.entries(copy(lists)));
  const revisions = new Map();
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  const context = { crypto, prompt: () => null, confirm: () => true, alert() {} };
  const api = createApi({
    baseUrl: options.apiBaseUrl || '',
    hostname: options.hostname || 'localhost',
    fetch: (url, options) =>
      new Promise((resolve, reject) => {
        requests.push({
          url,
          ...options,
          reject,
          reply(data, status = 200) {
            const id = new URL(url, 'http://flippy.test').searchParams.get('id');
            const success = status >= 200 && status < 300;
            if (success && this.method === 'POST') {
              const payload = JSON.parse(this.body);
              serverData.set(id, payload.list);
              revisions.set(id, (revisions.get(id) || 1) + 1);
              data = { list: payload.list, revision: token(payload.list, revisions.get(id)) };
              status = 200;
            } else if (success && Array.isArray(data)) {
              serverData.set(id, copy(data));
              data = { list: data, revision: token(data, revisions.get(id) || 1) };
            }
            resolve({ ok: success, status, json: async () => copy(data) });
          },
        });
      }),
  });
  const workspace = createWorkspace({
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    api,
    dialogs: context,
    random: (bytes) => context.crypto.getRandomValues(bytes),
    scheduler: {
      set: (callback) => {
        timers.set(++timerId, callback);
        return timerId;
      },
      clear: (id) => timers.delete(id),
    },
  });
  const disconnect = workspace.connect({
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  });
  return {
    workspace,
    context,
    storage,
    requests,
    listeners,
    serverData,
    saved: () => JSON.parse(storage.get('liststorage')),
    posts: () => requests.filter((request) => request.method === 'POST'),
    async flush() {
      await nextTick();
      await new Promise((resolve) => setImmediate(resolve));
    },
    async tick() {
      await this.flush();
      const pending = [...timers.values()];
      timers.clear();
      const requestCount = requests.length;
      pending.forEach((callback) => callback());
      await this.flush();
      for (const request of requests.slice(requestCount)) {
        if (request.method === 'GET') {
          const id = new URL(request.url, 'http://flippy.test').searchParams.get('id');
          request.reply(serverData.get(id) || [], serverData.has(id) ? 200 : 404);
        }
      }
      await this.flush();
    },
    dispose() {
      disconnect();
      workspace.dispose();
    },
  };
}

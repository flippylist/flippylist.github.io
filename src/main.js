import { createApp } from 'vue';
import App from './App.vue';
import { createApi } from './services/api.js';
import { createWorkspace } from './workspace.js';
import './styles.css';

try {
  const workspace = createWorkspace({
    storage: localStorage,
    api: createApi({
      baseUrl:
        import.meta.env.VITE_API_BASE_URL ??
        (import.meta.env.DEV ? '' : 'https://flippylist-api.vercel.app'),
      hostname: window.location.hostname,
    }),
    dialogs: window,
  });
  createApp(App, { workspace }).mount('#app');
} catch (error) {
  // A storage failure must never initialize and save an empty replacement workspace.
  const message = document.createElement('p');
  message.className = 'storage-error';
  message.setAttribute('role', 'alert');
  message.textContent = 'Could not open your saved lists: ' + error.message;
  document.getElementById('app').replaceChildren(message);
}

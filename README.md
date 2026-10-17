# Flippylist frontend

The list app at [flippylist.github.io](https://flippylist.github.io/), built with
Vue 3 and Vite. This repository is the frontend's only source of truth. The small
[Vercel API](https://flippylist-api.vercel.app/health.json) lives separately in
`4ty711/flippylist`; SpreadDB stays at spoo.io.

## Develop

Use Node.js 24 (`nvm use`), then:

```sh
npm ci
npm run dev
```

Vite serves the app at `http://localhost:5173` and forwards `/api` to the local
backend at `http://127.0.0.1:3000`. Run `npm run dev` in the backend checkout too
when testing sync. Local-only lists work without a backend. Browser storage belongs
to the site's origin; production lists remain on the GitHub Pages origin.

To select another API, set the public `VITE_API_BASE_URL` in `.env.local` to its
origin before starting/building. The API must allow the frontend's origin through
CORS. Production defaults to `https://flippylist-api.vercel.app`.
Never put database credentials in frontend configuration.

## Where changes belong

| Area            | Files                                         | Responsibility                                                           |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Startup         | `src/main.js`, `src/App.vue`                  | Create dependencies, mount the app, attach/remove lifecycle listeners    |
| User actions    | `src/workspace.js`                            | Reactive lists, confirmations, item editing and list commands            |
| UI              | `src/components/`                             | List cards, editable text, items and sync messages; props in, events out |
| Appearance      | `src/styles.css`                              | Typography, colors, layout and content-width inputs                      |
| List format     | `src/domain/lists.js`                         | Validation, six-character IDs, list/task helpers                         |
| Browser storage | `src/services/storage.js`                     | Current local lists and durable sync metadata                            |
| HTTP            | `src/services/api.js`                         | API URLs, requests, response validation and errors                       |
| Sync            | `src/sync/controller.js`, `src/sync/state.js` | Upload/download coordination, conflicts and deletion                     |
| Tests           | `test/`                                       | Sync regressions, user actions, persistence and rendered components      |

The sync controller has no Vue or DOM dependency. Storage, HTTP and timers are
injected so tests can control failures and delayed responses. Each list has one
reactive sync status: publication (`local`, `attempted`, `published`), deletion
(`none`, `pending`, `deleted`), and activity (`idle`, `download`, `upload`, `delete`, `pin`).
Current request identities ensure late responses cannot revive a deleted list.
UI error messages and request activity are not persisted.

Each read, create, edit, or delete sends one API request. An edit directly sends
its saved content token and uses the response as confirmation; there is no extra
download before or after it. The backend uses one SpreadDB data request per
operation. Initial authentication and expired-token renewal are separate.

Lists use the existing storage/API format: an array with title/background/online
metadata at index zero, followed by `{title, done}` tasks. That boundary remains
unchanged so current lists survive the cleanup. Storage contains current copies
only; there is no list history or recovery feature.

New shared lists require a six-digit PIN. Adding a list sends its ID and PIN once
to `/api/join`; the device remembers the returned access credential for normal
sync and deletion. The **PIN** button sets or changes the PIN without disconnecting
devices that already have access. Existing lists stay accessible until a PIN is
set. Reload existing devices before setting their first PIN so they can remember
access. A device without access can use **PIN** to enter it and keep its local copy.

For a new feature, put UI in a component, behavior in workspace actions, and any
network/storage behavior in its service. Keep sync rules in the controller and
cover changes that could lose list contents with regression tests.

## Check and publish

```sh
npm run check        # lint, formatting, tests, production build
npm run format       # apply consistent formatting
npm run preview      # inspect dist/ locally
```

GitHub Actions runs these checks on pull requests and pushes. Successful pushes to
`main` publish only `dist/` to GitHub Pages. The Pages publishing source is **GitHub
Actions**. Build output is ignored by Git; Vite generates filenames with content
hashes so the HTML selects the matching JavaScript and CSS. No manual cache-version
strings, frontend copies in the backend repository, or Vercel frontend deployment
are needed.

The workflow uses Node 24 from `.nvmrc`; dependency versions are locked in
`package-lock.json`. The compiled Vue runtime ships with the app. Font Awesome is
used for the two existing sync icons. jQuery and ObjectId are no longer loaded.

## Behavior to preserve

- List items keep their content width; double-clicking a list title opens its color picker.
- Each list's new-item input has its own submit form and an explicit mobile Enter
  hint. Enter and the return-arrow button add to that list; do not rely on key-up events.
- Edits save locally before the upload debounce. Malformed responses and delayed
  downloads cannot discard local edits. A valid list with zero items syncs normally.
- Saves use last-save-wins: an older device can overwrite newer online changes.
  Downloads still preserve unsent edits and offer a choice if the copies differ.
- Deleting a shared list removes its database contents. Other devices retain their
  local copies and stop syncing that ID. Updates cannot create missing records.
  Sharing a surviving copy creates a fresh six-character ID.
- Joining a protected list requires its ID and PIN. Joined devices can read, edit
  and delete it without entering the PIN again.

Based on the original [Flippylist CodePen](https://codepen.io/Marco-Boelling/pen/dPGrqaz).

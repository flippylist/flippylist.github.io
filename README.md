# Flippylist

based on this Pen created on CodePen: [https://codepen.io/Marco-Boelling/pen/dPGrqaz](https://codepen.io/Marco-Boelling/pen/dPGrqaz).

Vue js drag and drop example, using HTML5 Drag and Drop API.

The frontend is published from this repository's `main` branch to
https://flippylist.github.io/. `config.js` contains the public Vercel API origin.
The API connects to SpreadDB at spoo.io; database credentials stay on Vercel.

Lists remain saved in this site's browser storage. When moving from the old
Google Cloud backend, open the device with the desired list contents and click
**Publish this copy** for each online list missing on the new server. Other
devices can then open that list's ID. The app never replaces local contents
with an empty or invalid response.

Sync errors appear below the list. Conflicting saves pause syncing and offer
the saved versions to choose from. Local recovery copies are retained in
`liststorage:backups`, and the backend retains earlier revisions.

Use **+** and leave the prompt blank to create a list, or paste an existing
list ID to open it. The link icon enables online sharing. Anyone with the list
ID can read and edit it, so share IDs only with intended collaborators.

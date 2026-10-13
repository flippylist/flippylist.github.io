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

Sync errors appear below the list. Detected conflicting saves pause syncing. Choose
**Load online copy** or **Use this device’s copy** to keep one current copy.
The database stores one current record per live list; there is no list history or
local recovery storage. Existing recovery copies are removed when the app reloads.
A small current sync token detects stale saves. Simultaneous writes across separate
server instances can still overwrite each other because SpreadDB has no atomic
conditional replacement.

Use **+** and leave the prompt blank to create a list, or paste an existing
list ID to open it. New list IDs have six lowercase letters/digits; existing
longer IDs still work. Database object IDs are separate from these sharing IDs.
The link icon enables online sharing. Anyone with the list
ID can read, edit and delete it, so share IDs only with intended collaborators.

The X button deletes the list from this device and removes its online contents.
Other devices keep their local copies and stop syncing when
they next connect. Only a small permanent deletion marker remains in the database.
**Share as new list** gives a surviving copy a fresh six-character ID. Switching
off the link icon only pauses sync; it does not delete the server copy.

If deletion fails, the local list stays available with **Retry delete**. Edits
made during deletion are also kept locally. Local-only lists that have never been
shared can be deleted without a connection.

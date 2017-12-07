# Offline Notes

An offline-first note app. Every device keeps a full replica in **IndexedDB**, edits are instant with or without a network, and devices reconcile through a small sync server using **version vectors** and **three-way merge**. A **service worker** serves the app shell offline.

> Portfolio reference implementation of a 2017 thesis prototype (React, IndexedDB, Service Workers, a CouchDB-style change feed, vector clocks). It was the first experiment behind my MS thesis on causally consistent synchronization; see [causalsync](../causalsync).

## Sync model

Each note carries a version vector (`{deviceId: counter}`) and its **base**, the last version known to be on the server, which is the common ancestor for merges.

```
device: pull /api/changes?since=<checkpoint> ─▶ integrate each change
          before → fast-forward      after → keep local (will push)
          concurrent → three-way merge against base
              clean    → merged result (new vv dominates both), pushed next
              conflict → keep local text, store "theirs", ask the user
        push dirty notes ─▶ server: accepted | merged (server-side diff3) | stale | conflict
```

- **Never loses text**: on a true conflict the local version stays in the editor, and the other version is shown side by side with *keep mine / keep theirs / combine*. A resolution's vector dominates both, so it wins everywhere.
- **Merge rules** ([shared/notes.js](shared/notes.js)): body via line-based **diff3** ([shared/diff3.js](shared/diff3.js), an LCS-based implementation of the classic algorithm); title as a single register; tags as a set (adds on either side kept, removals honored); **edit beats concurrent delete**.
- **Server-side merge**: even a client that pushes without pulling first gets a clean merge when the edits don't overlap.
- **Change feed with checkpoints**: monotonically increasing sequence numbers, paginated, so a device that has been offline for weeks catches up exactly.
- **In-flight safety**: if you keep typing while a push is in flight, the note stays dirty and is pushed again.
- **Service worker**: versioned cache-first app shell; API calls are never cached (the replica is the offline data layer).

## Run

```bash
npm install
npm run build
npm start         # http://localhost:3000 (open in two browsers, toggle DevTools "Offline" to try it)
```

## Test

```bash
npm test          # vector clocks, diff3 cases, note merge rules, and multi-device sync through the real server
```

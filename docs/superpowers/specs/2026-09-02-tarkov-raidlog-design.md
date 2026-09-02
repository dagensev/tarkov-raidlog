# Tarkov Raidlog — Design

**Status:** approved 2026-09-02. Phases 1-3 implemented; squad sync outstanding.

## Problem

Escape from Tarkov exposes no API for your own quest progress, but the game writes
everything we need to local log files. TarkovMonitor (C#, desktop) proves the log events
are parseable; TarkovTracker (Vue + Firebase) proves the task-dependency and team-sync
model. Neither is a website that reads your logs directly.

Tarkov Raidlog is that: a Next.js site that reads the local log folder in the browser,
derives **current-wipe** quest progress from it, and during a raid shows the map you are
on with the tasks, required keys and wiki links relevant to it — for you and your squad.

Constraint: host it for $0 permanently, on nothing that pauses or expires.

## Verified findings

Established first-hand against a real log directory
(`C:\Battlestate Games\Escape from Tarkov\Logs`, 27 session folders spanning
2025-11-15 → 2026-09-02, game versions 1.0.0.0.41760 → 1.1.0.1.46911). Both reference
repos are on branch `master`, not `main`.

### Quest progress

`*push-notifications_000.log` carries `Got notification | ChatMessageReceived` followed by
a JSON block whose `message.templateId` is `"<24-hex taskId> <suffix>"`.

| suffix | `message.type` | meaning |
| --- | --- | --- |
| `description` | 10 | task accepted |
| `successMessageText` | 12 | task completed |
| `failMessageText` | 11 | task failed |

The correlation held across every folder scanned. The **suffix is authoritative** and the
numeric type is a cross-check only, so a renumbering by BSG degrades rather than breaks.
`message.dt` is unix seconds and is preferred over the log line's own timestamp, which
drifts when the game replays queued notifications on login.

Scan result: 147 task events, 97 distinct task ids.

### Raid and map

- `UserConfirmed` payload: `location`, `raidMode`, `shortId`, `profileid`.
- `UserMatchOver`: raid over.
- `*application_000.log`: `scene preset path:maps/<scene>.bundle` — the *earliest* map
  signal, ahead of `UserConfirmed` — plus `Session mode: PvpSeason|Regular|Pve`,
  `MatchingCompleted:… real:…`, `LocationLoaded:`, `GameStarted:`.

### Group

`GroupMatchInviteAccept`, `GroupMatchRaidReady`, `GroupMatchStartGame`,
`GroupMatchUserLeave`, `GroupMatchRaidSettings`, carrying `Info.Nickname`, `Info.Side`,
`Info.Level`. `Info` sits at the top level for invites and under `extendedProfile` for
ready-ups. A leave payload with no nickname means the local player left.

### Wipe detection

Profile ids are MongoDB ObjectIds; the first four bytes are a Unix creation timestamp.
A wipe creates a fresh PMC and Scav profile in the same second.

| generation | created | folders | modes |
| --- | --- | --- | --- |
| `5e5c26bf…` | 2020-03-01 | 9 (2025-11-15 → 2025-12-07) | Regular, Pve |
| `6934db41…` | 2025-12-07 | 0 | — |
| `6a8632b9…` | **2026-08-19** | 18 (2026-08-19 → 2026-09-02) | PvpSeason, Pve |

Two traps this design avoids, both found in the real data:

1. **Creation date is not the wipe date.** The `5e5c26bf` profile dates to 2020 yet was
   still in use in late 2025. Only a *change* of generation is a reliable boundary.
2. **Do not group profiles by co-occurrence in a folder.** EFT's PvE mode has its own
   profile, and the 2025-12-06 session contains a profile created mid-session. Union-find
   over co-occurrence would silently fuse PvP and PvE progress.

So: group ids into generations by ObjectId creation time; attribute each folder to the
generation that dominates it; **current wipe is the generation owning the newest folder**,
not the newest-created profile — which would wrongly pick a PvE profile made after a wipe.
A generation that never dominates a session (the `6934db41` one) is still reported, with
zero owned folders.

Filtering to the current wipe drops 9 stale task events of 147. Distinct task-id counts
are *equal* across the two wipes (97), because the same early quests are redone each wipe
— which is why the test asserts on events and timestamps, not on distinct ids.

### Hosting

- Workers Free: 100k requests/day, **10 ms CPU per invocation** — too tight for Next.js
  SSR. But requests to **static assets are free, unlimited, and do not invoke the Worker**.
- **Durable Objects are on the Free plan** (SQLite-backed only; free-plan users are not
  charged for SQLite storage). D1 free: 5 GB, 5M row reads/day.
- TarkovTracker's own `firebase.json` uses exactly this shape: static `dist/`, catch-all
  rewrite to `index.html`, and `/api/v2/**` to a single Cloud Function. No SSR anywhere.
- Supabase was considered and rejected: its free tier **pauses a project after one week of
  inactivity**, which is the wrong failure mode for a tool used in bursts between wipes.
- tarkov.dev is called straight from the browser. `NEXT_PUBLIC_TARKOV_ENDPOINT` can point
  at a same-origin Worker proxy if their CORS policy ever stops allowing it.

## Architecture

Next.js **static export** on Workers Static Assets, one Worker for `/api/*`, one
SQLite-backed Durable Object per squad. All parsing runs in the browser; the server only
brokers squad state. Data access stays behind `lib/tarkovdev/client.ts` and `lib/store/*`
so adopting vinext/OpenNext later is a contained change.

### Reuse

- **TarkovMonitor** — log-type-by-filename-suffix (which is why `push-notifications_000.log`
  resolves for free), the line regexes, and `taskId = templateId.split(' ')[0]`.
- **TarkovTracker** — `tarkovdata.js` builds the task graph with **graphology**
  (`mergeEdge(requirement.task.id, task.id)`, recursive `inNeighbors`/`outNeighbors`,
  `active` requirements inherit predecessors rather than adding an edge); `progress.js`
  computes availability from parents + `minPlayerLevel` + trader levels + faction. That
  dependency logic is what was worth borrowing, and it ports cleanly.

### tarkov.dev is a JSON API, not GraphQL

An earlier draft of this design was built against `api.tarkov.dev/graphql`, following
TarkovTracker's `tarkovdataquery.js`. That endpoint now answers
`422 {"errors":["GraphQL server unavailable. Try again later."]}` to every request,
including a bare `{maps{id}}`, from Node and from a browser on tarkov.dev's own origin.
It was mistaken for an outage. It is not: **tarkov.dev has retired GraphQL.** Their API
page states the replacement plainly — "the API serves JSON responses to simple GET
requests" — with the endpoint list at `https://json.tarkov.dev/endpoints`. TarkovTracker's
query is therefore a stale reference, useful only for its field names.

Three properties of the replacement drive `lib/tarkovdev/`:

1. **Normalized.** `task.trader`, `task.map`, `taskRequirements[].task` and
   `neededKeys[].keys` are id strings. The client denormalizes into nested objects so the
   graph, availability and UI code stay as written.
2. **Separately localized.** `task.name` is the translation *key* `"<id> name"`, resolved
   against `<path>_en`, a flat dictionary. Map names use `"<id> Name"` — capital N.
   `wikiLink` and `normalizedName` are plain and need no lookup.
3. **Split by game mode** — `regular`, `pve`, `pvp-season` — which maps one-to-one onto
   the `Session mode:` values the logs already give us, so the dataset follows what is
   being played.

Two inconsistencies worth knowing, both found by testing against the live service rather
than by reading: `tasks` and `maps` nest their collection under `data.tasks` / `data.maps`,
but **`traders` keys its objects directly off `data`** — reading `data.traders` silently
yielded an empty list and rendered trader ids in place of names. And `kappaRequired` is
true for only 13 of 491 tasks in the seasonal mode, so any assertion that it is common is
wrong.

Payload sizes shape the loading strategy: tasks 2.0 MB, tasks_en 249 KB, traders 49 KB,
maps 9.5 MB (stripped to per-map metadata on arrival, since the bulk is mobs and loot
containers), **items 15.8 MB**. Items exist only to name the ~90 key items tasks
reference, so they load after the task list is on screen and are filtered down to those
ids before being cached.

### Map detection is data-driven

Both log signals match a field the API publishes, so this is exact lookup, not a
maintained table:

- `scene preset path:maps/customs_preset.bundle` matches `GameMap.scenePath` verbatim.
- `UserConfirmed.location` matches `GameMap.nameId` — including `bigmap` for Customs.

An earlier hardcoded table got two cases wrong that the data settles: `sandbox_start_preset`
is Ground Zero **Tutorial**, and `factory_night_preset` is **Night Factory** — both
separate maps with separate task lists.

### Departure from the references

TarkovMonitor matches records with a multiline regex over the whole buffer. That is unsafe
for incremental tailing, where a poll routinely lands mid-JSON-block. Raidlog uses a
stateful `LogRecordSplitter` that holds back the trailing record until either a following
header arrives or the record's JSON block closes, so live events surface immediately
without ever parsing a partial object.

## Identity and squads

The invite link and Discord answer different questions and both are kept:

- **Invite link** (`/j/<token>`, 8-char Crockford base32) is the *address* — which squad.
  Discord cannot know that. Meant to be pasted into chat and clicked, not typed.
- **Discord OAuth** (`identify` scope only, no bot, no `guilds`) is the *identity* — who a
  row in the squad list is. It also makes the link one-time rather than every-session,
  since guest identity lives in IndexedDB and dies with browser data.
- **Guest mode requires no login.** Member records are keyed by an internal id with
  Discord as an *attachable* identity, so a guest who signs in later keeps their history.

Only completed task ids, level, faction and current map are ever published to a squad. No
log contents, no account data.

## Known constraints

- **Chrome/Edge only** — the File System Access API does not exist in Firefox or Safari.
  Those browsers get a manual import path and an explanation, not a broken page.
- **Updates only while the tab is open.** A background companion agent is the fix; deferred.
- Progress predating the earliest log on disk must be ticked off by hand once.
- Static export means no server components, no server-side data fetching, no ISR.

## Phases

1. **Parser and wipe detection** — headless and fully tested. *Done.*
2. **Local tracker** — File System Access watcher, tarkov.dev client, task graph, task list.
3. **Raid and map view** — map detection, per-map objectives and required keys.
4. **Squad sync and deploy** — Worker, Durable Object, invite links, Discord OAuth.

Later: hideout, item and barter needs, Kappa and Lightkeeper progress, queue-time stats,
and an optional local companion agent for non-Chromium browsers.

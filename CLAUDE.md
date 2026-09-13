# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Keeping this file current

Update this file in the same change that makes it wrong, rather than leaving it for later. What goes stale first:

- A script added or renamed in `package.json`, or a change to which vitest project owns a path.
- A new server route, which touches both `worker/index.ts` and `run_worker_first` in `wrangler.jsonc`.
- A change to where data comes from: a different shape from the tarkov.dev API, another log source, a new persisted key in the IndexedDB store.
- A new top-level directory under `src/lib/`, or one that stops existing.
- Anything under "Conventions that bite" that stops being true. Those lines are the ones most likely to send a future session the wrong way.

Leave the rest alone. This file exists for the picture that takes several files to reconstruct. A component inventory or a directory tree is noise here, since Glob produces it on demand and a written copy rots. Do not restate AGENTS.md.

## Commands

```bash
npm run dev            # Next dev server on :3000 (the app; the Worker is not in the loop)
npm run build          # static export into out/
npm run worker:dev     # wrangler dev on :8787 — serves out/ plus /api/*; run build first
npm run deploy         # next build && wrangler deploy
npm run lint
npm run typecheck
npm test               # both vitest projects
npm run test:worker    # workerd project only
npm run worker:types   # regenerate worker-configuration.d.ts after changing wrangler.jsonc
```

`.claude/launch.json` defines `raidlog` (:3000) and `raidlog-worker` (:8787) for the preview tools.

### Tests

Two vitest projects, and `npm test` is the only thing that runs both:

- `vitest.config.mts` — node environment, `src/**/*.test.ts`.
- `vitest.workers.config.mts` — `@cloudflare/vitest-pool-workers`, `worker/**/*.test.ts`. These run inside workerd so Durable Objects, SQLite and WebSocket hibernation behave as in production. The default config does not pick them up.

Single file or single test:

```bash
npx vitest run src/lib/logs/__tests__/parse-line.test.ts
npx vitest run -t "reassembles a JSON block split across polls"
```

Three suites talk to the outside world and self-skip when it is absent, so a clean checkout still passes:

- `src/lib/logs/__tests__/real-logs.test.ts` parses a real game log directory, default `C:\Battlestate Games\Escape from Tarkov\Logs`, overridable with `EFT_LOGS_DIR`.
- `src/lib/tarkovdev/__tests__/live-api.test.ts` and `src/lib/maps/__tests__/live-svg.test.ts` hit tarkov.dev. `SKIP_LIVE_API=1` skips both.

## Architecture

### The static/Worker split

`next.config.ts` sets `output: "export"`. Every feature runs in the browser — logs are parsed locally, tarkov.dev is fetched client-side — so the UI ships as static assets that Cloudflare serves without invoking a Worker, which sidesteps the 10 ms CPU cap on the free plan.

`worker/index.ts` is the only server-side code. It answers `/api/*` and rewrites the pretty invite path `/j/<token>` into `/squad/?join=<token>`, because a static export cannot serve a dynamic route. Both prefixes are listed in `run_worker_first` in `wrangler.jsonc`; everything else is matched as an asset before the Worker sees it. Adding a server route means touching both files.

`worker/protocol.ts` is imported by the client through the `@worker/*` path alias so the wire format cannot drift between the two halves. `@/*` maps to `src/*`.

### Where data comes from

**The game's log folder**, through the File System Access API. `src/lib/logs/source.ts` defines the `LogSource` port; the watcher talks to that rather than to the browser API, which is what makes tailing testable in node and leaves room for a local companion agent later. `watcher.ts` keeps a byte offset and a live `TextDecoder` per file so a poll reads only new bytes and a UTF-8 sequence split across two reads survives. `patterns.ts` and `parse-line.ts` extract events (ported from TarkovMonitor and verified against real logs); `progress.ts` folds task events into one state per task; `wipe.ts` infers wipe boundaries from the creation timestamps embedded in profile ObjectIds.

**The screenshots folder**, separately picked. Escape from Tarkov writes the player's position into every screenshot's file name, so `screenshots.ts` derives the in-raid trail from a directory listing and never opens a file.

**tarkov.dev's JSON API**, not its GraphQL endpoint, which is retired and now 422s. See the header comment in `src/lib/tarkovdev/endpoints.ts`: documents are normalized (ids, not nested objects), display names live in separate `<path>_<lang>` translation dictionaries, and data is split by game mode. The mode comes from the log's `Session mode:` line unless overridden in settings. `client.ts` fetches a small core bundle first and defers the 16.7 MB item catalogue, so the task list renders before the big download finishes. The catalogue carries the prices and ages out after an hour (`PRICES_TTL_MS`); everything else lasts a day. `refreshData` only fetches what is behind, and `startPriceRefresh` re-checks every five minutes while the tab is visible.

### State

- `src/lib/store/app-store.ts` — zustand: log status, parsed events, fetched bundles, raid state, and the per-tab view controls. Watchers, poll timers, socket handles and in-flight latches deliberately live in module scope, not in reactive state.
- `src/lib/store/squad-store.ts` — the socket half, kept apart because its lifecycle is a WebSocket rather than a folder.
- `src/lib/store/db.ts` — one IndexedDB key-value store via `idb`. It persists the granted `FileSystemDirectoryHandle`, which is the one piece of state that cannot be rebuilt. `Settings` also holds the things no log and no API can tell us: hideout levels, trader loyalty, the two character skills, and how the crafts table should price a craft.
- `src/lib/store/hooks.ts` — derived views. These are `useMemo` hooks, not zustand selectors, because they return fresh objects that would fail zustand's identity check and recompute availability over ~500 tasks on every unrelated store change.

### Domain layers

- `src/lib/graph/` — graphology task graph and availability, ported from TarkovTracker. A requirement with status `active` inherits the prerequisite's predecessors instead of drawing a direct edge.
- `src/lib/maps/` — `calibration.ts` vendors tarkov.dev's per-map bounds and rotation; `project.ts` turns a game coordinate into a fraction across the SVG with no map library; `viewport.ts` holds the zoom, pan and clamp arithmetic so it can be tested without a DOM.
- `src/lib/sell/` — flea market keep list, fee model and verdicts.
- `src/lib/crafts/` — the crafts calculator. `pricing.ts` quotes the two markets, what an item costs on the flea or from a trader and what it clears there, honouring recorded trader loyalty; `routes.ts` adds barters and crafts on both sides of a row, as a tree up to three trades deep, choosing each route at a roubles-per-hour rate that `craft-row.ts` searches for (Dinkelbach's method), so a chain that adds craft time only wins when it earns more per hour. A barter's product is not found in raid, so its disposal never reaches the flea. `plan.ts` flattens the chosen tree into the ordered buy/craft/trade/sell steps the breakdown lists, in whole runs and items: it batches the row up to ten runs to find counts that come out even, and otherwise rounds up and lists leftovers. The breakdown's working is scaled to that same batch. `fuel.ts` holds the two facts in the app that came from outside tarkov.dev, the generator burn rate and which stations run without power (only the Lavatory); `unlocks.ts` puts back the quest gates tarkov.dev's crafts document drops, from the tasks' `craftUnlock` rewards; `craft-row.ts` costs a craft end to end and reads logged task progress to say whether it can run; `filters.ts` is its view state.
- `src/lib/table/` — `window.ts`, the row windowing arithmetic. Under `sell/` until the crafts table proved there was nothing about selling in it.
- `src/lib/tasks/` — filtering, sorting and map options for the task list.

## Conventions that bite

- **The logs are the only source of task progress.** There is no manual override, and the ability to mark a task done by hand was deliberately removed.
- **Both cached catalogue halves are versioned, and both gates matter.** `SELL_INDEX_VERSION` and `ECONOMY_BUNDLE_VERSION` make `catalogueBehind` refetch, but a cache lives up to a day, so `useSellIndex` and `useEconomy` also refuse to serve a copy of the wrong version — otherwise today's components read yesterday's fields until the download lands. Bump the version in the same change that adds or renames a field.
- **A craft ingredient count comes in two shapes.** `ItemRequirement.count` is ceilinged for anything shown to the reader; `exactCount` is the unrounded figure, and costing must use it. Purified water asks for 0.66 of a water filter.
- **`globals.css` zooms the root element**, so laid-out pixels and drawn pixels differ by a constant. Anything read from `getBoundingClientRect()`, `clientX/Y` or `window.innerHeight` that ends up back in a CSS length must be divided by `uiScale()` from `src/lib/ui-scale.ts`.
- **Keep log regexes non-global.** They are reused across calls, and `lastIndex` would carry between them.
- Comments here carry the reasoning, often at length, and cite the source that was ported or the observation that forced the shape. Match that when editing.
- `tasks.json` at the repo root is a captured API response kept for reference. No code imports it.

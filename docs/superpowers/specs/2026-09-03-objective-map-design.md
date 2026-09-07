# Objective Map — Design

**Status:** approved 2026-09-03. Extends the Raidlog design of 2026-09-02; nothing in that
document changes.

## Problem

The raid board answers "what can I get done on this map and what do I need to bring". It
cannot answer **where**. A task row says "stash the gunpowder at the drop spot"; finding
that spot means leaving for the wiki or a third-party map.

Tarkov Market solves the position half of this with [Tarkov Pilot](https://github.com/ggdiam/TarkovPilot):
a Go/Wails desktop app that watches the game's Screenshots folder and posts filenames to
their site, which decodes the coordinates and draws a marker. It needs a signed Windows
binary, an auto-updater, a tray icon, a connection key and an account, because their
website cannot read local folders.

**Raidlog already can.** `FileSystemAccessLogSource` exists, and the position data is in
the *filename*, not the file. Everything Pilot's companion app is for, Raidlog does with a
second directory handle.

So: a 2D map on the raid board showing where this raid's objectives are, and — for the
screenshots you take — where you are.

## Verified findings

Established first-hand on 2026-09-03 against a real screenshot, a real log session, and
live tarkov.dev data. Reference repos `ggdiam/TarkovPilot` and `the-hideout/TarkovMonitor`
are both on branch `master`.

### The game writes your position into the screenshot filename

One real screenshot, taken on Customs:

```
2026-09-03[18-15]_356.64, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png
```

`date[HH-MM]_x, y, z_qx, qy, qz, qw_fov (n).png`. Position carries **two** decimal places,
the quaternion **five**. TarkovMonitor's two-stage regex parses it unchanged and correctly
rejects both OS screenshots and malformed names.

Run through the full pipeline, against the session log that says
`scene preset path:maps/customs_preset.bundle` and `Location: bigmap`:

| step | result |
| --- | --- |
| parsed | `x=356.64  y=2.58  z=-24.30` |
| yaw | `105.67°` |
| projected | `u=0.319  v=0.480` — inside the map |
| nearest published feature | **0.1 m** from a player spawn; 15.1 m from Warehouse 4 |

A tenth of a metre from a spawn point tarkov.dev publishes. The position half is not a
plausible design, it is a measured one.

**No file is ever opened.** The timestamp is in the name, so scoping screenshots to the
current raid needs only a directory listing. Reading `lastModified` would cost a
`getFile()` per entry, which is what would make polling a folder of thousands of PNGs
expensive. TarkovPilot's own source says the same of its approach: *"the file name
contains coordinates — the website parses them, the app doesn't read the file."*

### Yaw is an ordinary Unity Y-up rotation

TarkovMonitor's `QuarternionsToYaw` declares its parameters `(x, z, y, w)` but is *called*
with `(rx, ry, rz, rw)`. The shuffled names read like a deliberate axis swap. They are not
— following the call through, it computes the standard rotation about Y:

```
yaw = atan2( 2(w·y + x·z),  1 − 2(y² + z²) )
```

The real quaternion is pure Y-axis — `qx` and `qz` are exactly `0.00000` — so it reduces
to `2·atan2(y, w)`. Both forms give `105.67°`, leaving no ambiguity in the maths.

What remains is a display constant: tarkov.dev adds `coordinateRotation` to the marker's
CSS rotation, and a further 180° when that value is 90 or 270. One number, settled by
looking at the rendered arrow, not on paper.

### Objective coordinates are already in every user's IndexedDB

`json.tarkov.dev/<mode>/tasks` carries geometry on objectives. 525 of 1398 objectives have
it, and the gaps are all things with nowhere to point:

| has coordinates | | no coordinates | |
| --- | --- | --- | --- |
| `visit` | 192/209 | `giveItem` | 0/288 |
| `plantItem` | 114/127 | `findItem` | 0/137 |
| `findQuestItem` | 106/107 | `giveQuestItem` | 0/96 |
| `mark` | 79/83 | `extract` | 0/79 |
| `shoot` | 15/185 | `buildWeapon` | 0/30 |

`shoot` is low because most kill objectives have no fixed place, which is correct.

Two shapes. `zones[]` is a volume — `position`, `size`, an `outline` polygon, `top` and
`bottom` heights, and a `map` id. `possibleLocations[]` is a set of candidate spots for one
quest item: `{ map, positions[] }`.

**No new fetch and no cache bump.** `loadCoreBundle` stores `RawTask` whole — unlike maps,
which get `stripMap`'d — so this data is already cached. `possibleLocations` is even
already declared on `RawObjective`. It is lost only at the last step: `denormalize` builds
each objective field by field and copies neither.

One trap the data exposes: **zone and location map ids need the same folding the rest of
the app applies.** Night Factory carries 64 pins across 20 tasks in its own right, and
`FOLDED_INTO` rewrites it to Factory everywhere else. Matching pins on a raw `zone.map`
would drop every one of them from Factory's map, on a map that is only ever shown as
Factory. `foldedMapIds` already exists for exactly this and must be applied here too.

### Rendering calibration exists, and is correct

The transform is *not* in the JSON API. It lives in `the-hideout/tarkov-dev`'s
`src/data/maps.json` — `bounds`, `coordinateRotation`, `svgPath`, per-floor height ranges —
served with `Access-Control-Allow-Origin: *`, as are the SVGs on `assets.tarkov.dev`.

Checked two ways rather than trusted:

1. **Positions.** ~2,600 published spawn and extract points pushed through the projection.
   Eleven of thirteen maps put **100%** inside bounds, with the fractional spread filling
   0→1 as it should. Factory 95% (edge spawns, slightly tight bounds); Icebreaker 84%,
   which has no SVG anyway.
2. **Aspect ratio.** Every SVG's `viewBox` against its rotated bounds. Worst drift **0.94%**
   (Customs), most under 0.25%. A mismatch here would slide every pin.

Only **Reserve** declares a separate `svgBounds`; everywhere else the marker bounds and the
picture bounds are the same rectangle.

### Leaflet is not needed

tarkov.dev builds a Leaflet CRS from `transform` and `coordinateRotation`. The `transform`
array looks essential and is not: the SVG overlay and the markers project through the same
CRS, so it cancels out of any *relative* placement. Only `bounds` and `coordinateRotation`
matter, which is roughly fifteen lines of arithmetic — and is what both checks above
already ran on.

### The SVGs are cheap, and stack their floors

Customs is **193 KB**, Streets 335 KB — against 0.5–11.5 MB for the 3D JPEGs the existing
`Map3d` panel loads. There is no bandwidth reason to collapse this panel.

Floors are sibling groups in one file: `<g id="Ground_Level">`, `Second_Floor`,
`Third_Floor`, `Underground_Level`. Non-ground groups carry `class="shadow"`, which is only
`filter: drop-shadow(...)` — they are fully opaque. A plain `<img>` therefore renders every
floor at once, which is why the SVG has to be fetched as text and inlined so the inactive
groups can be hidden.

Three maps have no SVG at all: **The Lab, The Labyrinth, Icebreaker**.

## Architecture

Everything new is client-side. No Worker route, no API, no change to the static export.

```
Screenshots/  ──list names──▶ parse filename ──▶ {x, y, z, yaw, takenAt}
                                                          │
Logs/ ────────▶ (existing) raid.at, raid map ─────────────┤
                                                          ▼
tasks (IndexedDB) ──▶ zones + possibleLocations ──▶  project(x, z) ──▶ {u, v}
                                                          │
calibration table ──▶ bounds, rotation, floors ───────────┘
                                                          ▼
                                              pins + trail over the SVG
```

### New modules

| File | Purpose |
| --- | --- |
| `lib/maps/calibration.ts` | Vendored `bounds` / `svgBounds` / `coordinateRotation` / `svgPath` / floor height ranges |
| `lib/maps/project.ts` | Pure: game `(x, y, z)` → `{u, v}` plus floor selection. No DOM. |
| `lib/logs/screenshots.ts` | Pure: filename → position, or `null` |
| `lib/logs/screenshot-source.ts` | `ScreenshotSource` port, with File System Access and in-memory implementations |
| `components/objective-map.tsx` | The panel |

### Calibration is vendored, not fetched

Thirteen entries of static data that change only when somebody redraws a map. Fetching it
at runtime would add a third-party dependency, a CORS surface and a failure mode to a
feature that otherwise has none. `maps-3d.ts` already set this precedent, including a
documented refresh procedure; this follows it.

### `ScreenshotSource` is a new port, not a reuse of `LogSource`

`LogSource` is shaped around byte-offset tailing — `stat`, `readFrom`, folder-then-file
addressing — none of which means anything here. Screenshots need one method:

```ts
interface ScreenshotSource {
  /** File names in the screenshots directory. Names only: nothing is opened. */
  list(): Promise<string[]>;
}
```

Same benefit as `LogSource`, for the same reason: the watching logic gets tested without a
browser.

### Changes to existing code

- `raw-types.ts` — add `zones` to `RawObjective` (`possibleLocations` is already declared)
- `types.ts` — add both to `TaskObjective`
- `client.ts` — `denormalize` passes them through
- `db.ts` — `screenshotDirectory` in `StoredValues`; pin visibility in `Settings`
- `app-store.ts` — `screenshotStatus`, a connect action, the trail, and the poll
- `raid/page.tsx` — mount the panel above the keys
- settings page — the screenshots folder picker

The screenshots poll rides the existing 2 s loop rather than adding a timer, and runs only
while a raid is active.

## Behaviour

**Placement.** A panel on the raid board, above "Bring these keys", open by default. Every
input it needs — detected map, map picker, held tasks — is already on that page, so no
context is duplicated. `Map3d` stays below it, still collapsed: one map is for finding
things, the other for recognising them.

**Pins.** Tasks you are *holding* on this map, and nothing else — the same set the task
list below already shows, so the two cannot disagree. A toggle hides them entirely for an
uncluttered map. At this scope a map carries roughly 10–30 pins; the theoretical maximum
across all tasks is 261 (Lighthouse), so density never needs clustering.

- zone objectives — translucent polygon from `outline` where present, dot at `position`
  otherwise
- `possibleLocations` — small dots, styled to read as "one of these"
- clicking a pin highlights the matching row in the task list

**Position.** Every screenshot from the current raid as a faint dot, joined in order, the
most recent drawn as an arrow showing facing. Screenshots are attributed to a raid by
their filename timestamp against `raid.at`.

The trail is **derived, not accumulated**. Each poll lists the directory and keeps the
names whose timestamp falls after the current raid started, so there is no growing state
to clear, reloading the page mid-raid rebuilds the same trail, and a new raid empties it by
moving `raid.at` rather than by an explicit reset. The trail stays on screen after
extraction until the next raid begins.

**Floors.** Auto-selected from the screenshot's `y` against each layer's published height
range, and manually overridable. This is the one thing Pilot does not do: on Streets,
standing on a third floor switches the map to that floor by itself.

**Pan and zoom** reuse the Fit/Zoom and `overflow-auto` pattern already in `Map3d` rather
than introducing a second gesture model.

## Failure modes

| Case | Behaviour |
| --- | --- |
| Firefox / Safari | Map and pins work fully. Only position is unavailable — **the map is not gated on File System Access** |
| No SVG (Lab, Labyrinth, Icebreaker) | Panel hides itself, the same convention `Map3d` uses for maps with no render |
| Screenshots folder absent | Explains it is created by your first in-raid screenshot. This was the machine's real state before one was taken |
| Permission lapsed | Reconnect button, the same pattern as logs |
| OS screenshots in the folder | Fail the regex; ignored silently |
| Quaternion missing or unparseable | Dot with no arrow, rather than a confidently wrong arrow |
| Map has no calibration entry | Panel hides itself |

## Testing

- `lib/maps/__tests__/project.test.ts` — the research check as a standing test: published
  spawn and extract positions must land inside bounds. Also the Customs case end to end,
  asserting `u ≈ 0.319, v ≈ 0.480`.
- `lib/logs/__tests__/screenshots.test.ts` — parse and reject cases, seeded with the **real
  filename above** rather than synthetic ones, asserting `x=356.64, y=2.58, z=-24.30` and
  `yaw ≈ 105.67°`. Rejects an OS screenshot name and a truncated one.
- `lib/maps/__tests__/live-svg.test.ts` — aspect ratio of every live SVG against its
  rotated bounds, following the existing `live-api.test.ts` pattern, so a tarkov.dev redraw
  fails loudly instead of silently sliding every pin.
- `lib/store/__tests__/raid-state.test.ts` — extend for trail derivation across a raid
  boundary: screenshots older than `raid.at` are excluded, newer ones ordered.
- `lib/maps/__tests__/pins.test.ts` — objectives on a folded map (Night Factory) resolve
  onto Factory.

## Known constraints

- **Position is manual.** No screenshot, no dot. This is a "where am I / where have I been"
  tool, not live tracking, and the UI should say so rather than look broken.
- Screenshots folder inherits the logs folder's Chromium-only limit and its per-visit
  permission prompt.
- A relocated Documents folder (OneDrive) needs the picker, which is why the path is picked
  rather than derived.
- Calibration is vendored, so a redraw needs a refresh — caught by the aspect-ratio test.

## Out of scope

Trail history across raids, pin filtering beyond the on/off toggle, tile-based maps for the
three SVG-less maps, and objective pins for maps you are not currently on.

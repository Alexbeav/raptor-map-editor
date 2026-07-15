# Implementation roadmap

Planned improvements, in build order. Each item lists the approach, the code it
touches, how it gets tested, and what "done" means. Sizes: **S** = one working
session, **M** = one or two, **L** = several.

Ground rules that apply to everything below:

- The editor stays a single self-contained `index.html`; new data-layer code
  goes in the CORE block so `tests/test_editor_core.mjs` can unit-test it.
- No game data is ever committed. New tests must run fixture-independent by
  default and only use real GLBs when a directory is passed in.
- Every format-touching change keeps the byte-identical round-trip guarantee
  and gets a validator + a rejection test.
- Non-blocking diagnostics stay separate from hard validation: editor warnings
  never weaken the checks used by import, save, or command-line tools.
- Dirty-state additions must cover replacement-file confirmation, session
  reset, save-button counts, affected archives, save commit, autosave, and the
  beforeunload guard.

---

## Phase 1 — quick wins

**Status (2026-07-15): implemented.** CORE, Python, and synthetic Playwright
tests pass locally; the first hosted Playwright CI run is pending.

### 1. Redo (S)

Undo already snapshots whole maps/libraries as JSON (`undoStacks`, `libUndo`).
Give each stack a paired redo stack: `undo()`/`popLibUndo()` push the current
state onto redo before restoring; any new edit (`pushUndo`/`pushLibUndo`)
clears the redo stack. Bind Ctrl+Y and Ctrl+Shift+Z, add a Redo button next to
Undo, and extend the button-state updater to manage both. Fix the existing Undo
button at the same time: unlike Ctrl+Z, it currently always calls map undo even
when the Library tab is active. Both buttons dispatch by mode; music stays
excluded. Redo stacks use the same 100-snapshot cap as undo and are cleared by
`resetSession()`.

*Done when:* edit → undo → redo restores the exact pre-undo JSON on both maps
and library banks, a fresh edit after undo disables redo, and DOM tests cover
both buttons and both keyboard bindings in map and library modes.

### 2. FLATS (destructible tile) editing (S–M)

`parseFlats` and the `flatsLibs` cache exist; destructible markers already
render in the tile picker. Add the inverse `buildFlats` encoder to CORE
(8-byte records, trivial), editable fields in the Tiles tab when the selected
tile is destructible (`linkflat` target, `bonus` hp, `bounty`), a
`dirtyFlats` set mirroring `dirtyLibs`, and commit into `FLATSG{n}_ITM` on
save. Wire `dirtyFlats` through every dirty-state consumer listed in the ground
rules. Add the same inverse encoder to `tools/raptor_glb.py` before the mod CLI
needs it.

*Done when:* editing a tile's break-target/hp/bounty survives a save/reload
cycle and `FLATSG1_ITM` round-trips byte-identically when untouched.

### 3. Warnings panel (S–M)

Surface likely design defects without weakening validation. A
`collectMapWarnings(map, assets)` CORE function returns structured findings
with stable `code`, `severity`, sprite/group index, and map coordinates:
sprites whose `level` value never spawns
(anything outside `LEVEL_NAMES`), spawn groups whose head sits behind a
higher-y head (cursor stall), empty maps, sprites referencing missing library
entries, and tiles referencing missing banks/entries. Keep `validateMap` and
`validateMapAssets` as hard checks for imports and saves; share small internal
asset-check helpers rather than converting validation errors into warnings.
UI: a collapsible strip above the status bar with one line per finding;
clicking a finding selects the offending sprite and scrolls it into view.

*Done when:* seeding a map with each defect class produces exactly the
expected findings (unit-tested in `test_editor_core.mjs`) and click-to-jump
selects the right sprite.

### 4. Playwright CI smoke test (M)

Protects everything after it. Build a **synthetic fixture GLB** at test time
using CORE's own `buildGlb` (palette item, one tile bank + marker, a minimal
`SPRITE1_ITM`/`FLATSG1_ITM`, one valid map) — no game data involved. The
Playwright test loads `index.html` from disk, injects the fixture via a
`DataTransfer` drop, paints a tile, places a sprite, clicks save, and asserts
the downloaded GLB parses back with the edits present. Add a `playwright`
job to `.github/workflows/test.yml`; keep the existing fast jobs separate.
Add a minimal `package.json` plus lockfile and pin the Playwright version. The
fixture should use an accepted `FILE000n.GLB` filename and contain every item
the load path actually requires: palette, tile marker and graphic, sprite and
flats banks, sprite graphic, and one valid map.

*Done when:* CI runs load→edit→save headless on every push, in under ~2 min.

---

## Phase 2 — designer workflow

**Status (2026-07-15): implemented.** Multi-select/clipboard, versioned session
recovery, and guarded folder-backed saves pass synthetic Playwright tests
locally; the first hosted Phase 2 CI run is pending.

Community quick win already implemented: the placement and Library lists can
group enemy variants by their shared `iname` graphic without reordering the
underlying positional library.

### 5. Multi-select refactor + rectangle select, bulk ops, copy/paste (M–L)

One refactor unlocks three features, so it lands as a unit:

- **Refactor:** selection becomes a set with a primary sprite for the props
  panel. Do not use array indices as long-lived identities: deletion and
  `normalizeSpawnOrder` reorder the array. Give live sprites editor-only stable
  IDs (omitted by `buildMap`/JSON export), or provide an explicit selection
  remap after every reorder. Touch points: `updateProps`, `redraw`
  (highlight all selected), `deleteSelected`, drag handling, `propEdit`, and
  the places that reset selection (`openMap`, `undo`, `resetSession`).
- **Rectangle select:** shift-drag on the map in sprites mode draws a
  marquee; sprites inside join the selection. Plain click keeps current
  behavior.
- **Bulk operations:** Delete, difficulty change, and arrow-key/drag moves
  apply to the whole selection under a single `pushUndo()`. Deletion iterates
  `deleteSpritePreservingGroups` from the highest index down.
- **Copy/paste:** an in-app clipboard (JSON) capturing each whole spawn group
  once when any of its members is selected. Paste targets the cursor row,
  preserving the group's relative x/y layout, clamped to `MAX_SPAWN_ROW`,
  appended with
  valid terminators, then `normalizeSpawnOrder` keeps the engine invariant.
  Works across maps and banks (validated with `validateMapAssets` on paste).

*Done when:* marquee + bulk delete/difficulty/move/copy/paste all work, each
bulk action is one undo step, selection survives reorder where appropriate,
partial- and whole-group deletion preserve terminators, and pasted groups pass
both `validateMap` and `validateMapAssets`.

### 6. Session autosave (M)

Persist the whole session to IndexedDB (the raw loaded GLB bytes plus
`levels`, `dirty`, `dirtyLibs`, `dirtyFlats`, sprite/flats libs, music
assignments and custom MUS sources) — debounced after each `markDirty`-class
event. On startup, if a saved session exists, offer **Restore last session /
Start fresh** on the drop overlay. `resetSession()` and a successful save
clear or refresh the stored copy. Define "successful" by save mode: a direct
folder write is successful only after every write resolves; a browser download
cannot report that the user retained the file, so keep a clean recovery
checkpoint until the user starts fresh or explicitly discards it. Use a
versioned serialization schema for `Map`, `Set`, typed-array, and custom music
state. Data never leaves the machine.

*Done when:* killing the tab mid-edit and reopening restores maps, library
edits, music assignments, and dirty state exactly; declining wipes the store.

### 7. File System Access API (M)

Where supported (Chrome/Edge), add "Open game folder…": pick the directory,
read `FILE000n.GLB` directly, and on save write patched archives back
in place after copying originals to `FILE000n.GLB.bak` (first save only).
Feature-detect `showDirectoryPicker` and require a secure context and an
explicit user gesture; document a localhost/HTTPS launch option if direct
`file://` use is unsupported by the browser. The existing download flow remains
the fallback and the default elsewhere. Persist the directory handle in
IndexedDB, but call `queryPermission()`/`requestPermission()` when restoring it
because permission may not persist. Save all output bytes before starting
writes, create each backup without overwriting an existing one, and report
partial-write recovery instructions if a multi-archive save fails.

*Done when:* on a supported secure origin, open-folder → edit → save updates
the game directory with an unchanged first-save `.bak` beside each touched
archive; denied/revoked permissions and partial write failures are tested;
unsupported browsers still get downloads.

---

## Phase 3 — sharing

**Status (2026-07-15): implemented.** Browser and command-line `.rapmod` v1
apply paths share item-level SHA-256 requirements and materialize the same map,
sprite-library, FLATS, and MUS changes. Synthetic unit and Playwright tests
cover round trips, transactional rollback, mismatched bases, invalid asset
references, malformed music, and future-version sections.

### 8. Mod file export/import, v1 (L)

The point: share author-created changes **without copying the user's base game
data**. A `.rapmod` JSON file is a base-hashed patch, not a dump of complete
maps or libraries:

Classic IPS can remain a later interoperability option, but it is not the
primary sharing format: it patches raw offsets, does not identify the expected
base archive, and would need separate files for every touched GLB. `.rapmod`
can validate base item hashes, describe editor-level changes, preview them, and
apply several archives transactionally. This is a technical distribution
design, not a claim about the legal status of any particular mod.

```
{ "format": "rapmod", "version": 1,
  "requires": { "MAP1G1_MAP": "sha256:...", "SPRITE1_ITM": "sha256:..." },
  "maps": { "MAP1G1_MAP": { "tiles": [{ "r": 4, "c": 2, "value": {...} }],
                               "spriteGroups": [{ "at": 2, "delete": 1,
                                                   "insert": [[...]] }] } },
  "libs": { "1": { "fields": [{ "index": 12, "set": { "hits": 80 } }],
                     "append": [...] } },
  "flats": { "1": { "fields": [...] } },
  "music": { "RAP2_MUS": { "label": "...", "mus": "<base64 DMX MUS>" } } }
```

Export diffs current state against immutable session baselines and includes
only changed fields/groups plus appended author-created records. Import checks
base hashes, validates the fully materialized result of every section
(`validateMapAssets`, the sprite/flats builders, and strengthened MUS
validation) against the *user's own* loaded GLBs, previews what will change
(maps, banks, music slots and their coupled levels), then applies the whole mod
as one transaction. Failure restores maps, libraries, flats, and music; a
successful apply creates undo snapshots for every affected editor domain.
`version` gates future extensions; unknown required sections are rejected with
a clear "made with a newer editor" message. Mirror export/apply in
`tools/glbtool.py` (`mod2glb`) so mods are scriptable.

*Done when:* export→import on a matching clean session reproduces every edit;
the file contains no unchanged map cells or unchanged base library records; a
base-hash mismatch, missing sprite entry, or bad MUS is rejected with a
per-section error without partially applying the mod; CLI and browser produce
identical patched archives from the same base files.

---

## Phase 4 — content pipeline

### 9. In-browser PNG sprite/tile import (M–L)

Port the encode side from `tools/raptor_glb.py` into CORE: `encodePic`
(GPIC + GSPRITE segment encoding) and nearest-color palette quantization
against `PALETTE_DAT`. UI in the Library tab: drop/browse a PNG, pick
replace-existing (in place, order preserved) or append-new (item name field,
target file), with a live quantized preview before committing. Multi-frame:
accept several PNGs (or a horizontal strip) and append frames as consecutive
items, setting `num_frames` — the engine reads frames positionally after the
`iname` item, so consecutive append is mandatory. Enforce the same limits as
the CLI (≤320×200, ASCII names ≤15 chars). Insertion mid-archive stays
forbidden: tile graphics are addressed positionally (`STARTGnTILES + 1 + i`).

Testing: JS encoder output must be byte-identical to the Python encoder for
the same input (golden fixtures generated by a tiny script, committed as
PNG + expected bytes — synthetic art, no game data), plus decode(encode(x))
round-trips in `test_editor_core.mjs`. Keep browser-only PNG decoding outside
CORE; pass width, height, RGBA bytes, and the palette into DOM-free CORE
quantization/encoding functions.

*Done when:* a dropped PNG becomes a placeable enemy in the running editor,
and the parity test pins JS output to Python output byte-for-byte.

### 10. Gun-mount visual editing (M)

Extend the Library tab's waypoint canvas with a layer toggle: waypoints
(existing) / engine flares (`engx/engy`, `numengs`) / gun mounts
(`shootx/shooty`, `shoot_type`, `numguns`). Same interactions as waypoints:
drag to move, click to add (bumping the count), right-click to delete.
Values are already validated shorts in `buildSpriteLib`.

*Done when:* mounts render over the sprite preview at correct offsets and
edits round-trip through `buildSpriteLib` unchanged elsewhere.

### 11. Mod file v2 — embedded art (S, after #9)

Add a `"pics"` section to `.rapmod` (item name → base64 encoded PIC data +
replace/append operation and base hash for replacements). Import revalidates
dimensions and decodes each pic before applying. Bump `version` to 2; v1 files
keep importing.

### 12. In-browser MIDI → MUS conversion (M–L)

Community-requested (RetroGamer02). Today the Music tab links to skynettx's
[midi3mus](https://github.com/skynettx/midi3mus) for offline conversion;
this ports the conversion itself into CORE so dropping a `.mid` on the Music
tab "just works". Unlike OPL *playback* (dropped — see below), conversion
needs no sound emulation: parse Standard MIDI (format 0/1, tracks merged),
map the 16 MIDI channels to MUS channels (percussion → 15), translate
events (note on/off with running volume, the standard controller table,
14-bit → 8-bit pitch bend), rescale delta times to the 140 Hz MUS clock,
and emit the header's instrument list from the patches actually used —
then feed the result through the existing `validateMus`/import path.

Strengthen `validateMus` first: validate the instrument table implied by the
header, semantic event/channel/controller ranges, score termination, and
reasonable size limits. Specify tempo-map and SMPTE-division behavior,
same-timestamp ordering when format-1 tracks are merged, running-status rules
around meta/system events, percussion instrument numbering, SysEx handling,
and rejection of MIDI format 2.

Testing: fixture-independent (synthetic MIDI in → `validateMus` passes,
events spot-checked), plus golden files pinning output against midi3mus
for one or two committed public-domain MIDIs.

*Done when:* `.mid` files import directly on the Music tab with the same
warnings/slot behavior as `.MUS`; format 0/1, tempo changes, percussion, and
running status have focused tests; oversized or unsupported MIDIs are rejected
with a clear message.

---

## Phase 5 — preview

### 13. Scroll-playthrough preview (M–L)

A play button that animates the viewport bottom-to-top at the engine scroll
rate, with a difficulty selector. A CORE `spawnTimeline(map, difficulty)`
computes, from the forward-only spawn cursor semantics (enemy.cpp:691), when
each group spawns — reusing the exact invariant `normalizeSpawnOrder`
documents. During playback, sprites appear at their spawn moment and animate
their flight paths (approximating `repeat` ping-pong, `linear` one-shot exit,
`kamikaze` list-then-dive as a straight run at the viewport's centerline;
ground types scroll with the map). Explicitly labeled an approximation, not
emulation — no shooting, no collision.

*Done when:* the timeline function is unit-tested (groups spawn in list
order at their head rows; stalled groups never spawn — matching the warnings
panel), a committed synthetic worst-case map meets the frame budget in an
automated benchmark, and an optional user-supplied-GLB benchmark runs at 60fps
on the full 27-map set.

---

## Sequencing and risk notes

- **Order:** 1→2→3→4 (protection first), then 5→6→7, 8, 9→10→11→12, 13.
  Items 1–3 are independent and can ship in any order; 8 deliberately ships
  before 9 so the mod format is versioned from day one; 11 needs 9. MIDI
  conversion (12) is self-contained and can be pulled forward if the
  community wants it sooner.
- **Riskiest item:** the multi-select refactor (5) — it touches most UI code.
  The Playwright suite (4) exists specifically to land before it.
- **Security boundary:** mod import, autosave restore, MIDI/PNG import, and
  folder writes all consume untrusted or persistent data. Put size limits and
  validate-then-commit transactions at each boundary.
- **Dropped:** in-browser MUS *playback* (OPL emulation) — research cost far
  exceeds its value; revisit only if the community asks. MUS *conversion*
  from MIDI (12) stays: it needs no emulation.

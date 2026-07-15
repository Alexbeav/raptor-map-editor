# Code review — Phase 4 changes

**Status (2026-07-16): all findings resolved** in `8be6e13`. Every numbered
finding below was fixed and covered by a regression test (index-addressed
`pics` with unnamed-item fixtures, strict/lenient validator split, per-frame
replacement, append-aware undo, frame-name dedup, session-reset art clearing,
correct MUS channel counts, lowest-compatible rapmod version). The minor
cleanups were applied as well. Verified by the full battery: 33 core checks,
9 Python tests, 9 Playwright browser tests, all green; CI passing. The
findings are retained below for the record.

**Date:** 2026-07-16
**Scope:** working-tree diff against `ecd483a` (11 files: browser PNG import,
gun/engine visual layers, `.rapmod` v2 embedded artwork, MIDI→MUS conversion,
hardened MUS/PIC validators, tests and goldens).
**Method:** multi-agent review at high effort — independent finders per
correctness angle plus cleanup, every candidate adversarially verified against
the actual code (30 verified findings; the 10 most severe are below,
ranked most-severe first).

**Resolution (2026-07-16): addressed.** Artwork baselines and dirty state now
use `(archive, item index)` identity, and v2 `pics` is a positional array that
supports unnamed/duplicate-name replacement safely. Both importers validate
the original target as PIC data and reject cross-section collisions. Exports
remain v1 unless artwork requires v2. Legacy/original MUS input uses tolerant
structural validation while generated MIDI output is checked strictly. Frame
append undo/redo removes and restores GLB items, generated names are checked
for internal collisions, animated replacements require every frame, session
reset clears pending artwork, and MIDI headers use the allocated melodic
channel count. The minor cleanup findings were addressed as well.

The previously plausible finding 5 was not reproduced: strict validation
accepted all 5,743 PIC-like items and all 16 MUS items in the five original
archives. Display decoding is nevertheless tolerant, while imported artwork
continues through strict validation. Node, Python, Playwright, and real-data
round-trip suites pass after the corrections.

**Overall assessment.** The engineering discipline is strong: the JS PNG
encoder is pinned byte-for-byte to the Python encoder via a shared golden
vector, the MIDI converter is pinned to midi3mus 1.0.0 output at Raptor's
70 Hz clock, all tests stay fixture-independent, and Playwright exercises real
user flows including transactional rollback. The defects cluster into three
themes: (1) name-keyed art diffing that cannot survive real archives with
empty/duplicate item names, (2) backward-compatibility regressions from the
version bump and stricter validators, and (3) missing hardening in the new
pics section (type confusion, undo orphans, name collisions).

---

## Findings

### 1. Every `.rapmod` export breaks with real game data — `index.html:2749` (CONFIRMED)

`exportRapmod`'s pics loop diffs **every** GLB item by `item.name` against the
name-keyed `baselineItems` map. Real Raptor archives contain many
**empty-named** positional tile PICs, and `baselineItems` stores only the
first occurrence per name. Every second-and-later unnamed PIC therefore
"differs" from the single `""` baseline, so any export — even a one-cell map
edit — emits `pics[""] = {op:"replace"}`, which both importers reject
(`invalid PIC item name`). If two archives share a non-empty item name, the
export instead silently ships a replace that overwrites the recipient's first
same-named item with the *other archive's* data — corruption.

Same root cause also at `index.html:2393` and `index.html:2751`.

**Fix:** key art diffs by `(archive number, item index)` rather than name, or
restrict the pics export to the explicitly tracked `dirtyPics` set (which
would also need index keys for unnamed tiles).

### 2. rapmod pics can overwrite non-graphic items — `tools/raptor_glb.py:624` (CONFIRMED)

The pics `replace` op checks only that the target name exists and its hash
matches — never that the base item is actually a PIC. A v2 mod can overwrite
`MAP*_MAP`, `SPRITE*_ITM`, `FLATSG*_ITM`, or `RAP*_MUS` with PIC bytes,
bypassing those sections' semantic validators; and because pics are processed
last through the shared `replacements` dict, a pics entry silently clobbers a
validated earlier-section replacement. `pics: {"SPRITE1_ITM": {op:"replace",
pic:<valid GSPRITE>}}` with the right hash passes validation entirely and the
resulting GLB crashes Raptor at level load. The JS `prepareRapmod`
(`index.html:2854`) has the identical hole.

**Fix:** require `validate_pic(baseline_bytes)` to succeed on the *target*
item before accepting a replace, and reject pics names that collide with
items claimed by the maps/libs/flats/music sections.

### 3. Stricter MUS validator rejects previously valid data — `tools/raptor_glb.py:410` (CONFIRMED)

`validate_mus` went from structural to strict semantic validation (controller
must be ≤9 with value ≤127, system controller 10–14 only, note/release ≤127,
no bytes between the end marker and `scoreLen`, delay max 5 bytes instead
of 6). Consequences:

- v1 `.rapmod` files whose embedded MUS passed the shipped v1 validator are
  now rejected on import, despite README/help stating v1 stays importable
  (e.g. third-party-converted MUS with controller ≥10 or volume byte >127).
- The same regression exists in JS `validateMus` (`index.html:1475`), which
  also gates `initializeMusic` — if any original `RAP1–8_MUS` trips the new
  checks, that track **silently disappears** from the Music dropdown.

**Fix:** keep strict validation for newly *created* data (MIDI conversion
output), but validate imports/originals structurally, or downgrade the new
semantic checks to warnings on the import path.

### 4. All exports hard-coded to version 2 — `index.html:2708` (CONFIRMED)

`exportRapmod` always emits `version: 2` even when the mod contains no pics
section. Users of the previously released editor or `glbtool` hit "this mod
was made with a newer editor" for mods fully expressible in v1 — sharing
regresses for every export, not just ones using new features.

**Fix:** emit the lowest version that expresses the content
(`version: mod.pics ? 2 : 1`).

### 5. Strict `validatePic` in `decodePic` may blank shipped artwork — `index.html:1009` (PLAUSIBLE)

`decodePic` now runs `validatePic` first (exact GPIC size, `offset ===
y*320+x`, terminator requires both fields −1, dims capped at 320×200) where
the old decoder tolerated slack (size mismatches, clipped segments, dims to
1024, terminator on offset alone). Any shipped item the old decoder rendered
but the validator rejects now silently draws blank in the tile grid, sprite
previews, and gun/engine overlays. **Unverified against real GLBs — the
real-data suite has not been run against this working tree.**

**Fix:** verify with real data before committing; if anything fails, split
"strict validation for imported art" from "tolerant decoding for display".

### 6. Undo after frame append orphans GLB items — `index.html:2412` (CONFIRMED)

The append-sprite path snapshots only the sprite-library record via
`pushLibUndo()`. Undo reverts `iname`/`num_frames` but the appended GLB items
stay in `file.glb.items` and `dirtyPics`. Retrying the same import fails with
"already exists", and the orphaned frames are written into every saved GLB
and exported into every `.rapmod` as appends the user believed were undone.

**Fix:** give art appends their own undo entry that also removes the appended
items and their `dirtyPics` entries (they are always at the end of the items
array, so removal is safe).

### 7. Multi-frame append can generate colliding names — `index.html:2408` (CONFIRMED)

`artFrameNames` truncates the stem by different amounts per frame serial and
the duplicate check only tests against loaded archives, not the generated
batch. Example (verified by execution): 12 frames from base
`AAAAAAAAAAAAA1` produce `AAAAAAAAAAAAA12` for both frame 2 and frame 12. Two
same-named items get appended; on export the pics keys collide and one frame
is lost, leaving recipients with `num_frames` mismatched to the actual items.

**Fix:** check the generated name list for internal duplicates and reject
(or disambiguate deterministically) before appending.

### 8. Replace-sprite updates only frame 1 of animated entries — `index.html:2400` (CONFIRMED)

Replace-sprite writes the new graphic only to the `entry.iname` item. For
entries with `num_frames > 1`, the remaining consecutive frames keep the old
artwork — the enemy flickers between new and old art (possibly different
dimensions) in-game while the status line reports a full replacement.

**Fix:** for animated entries, either require one PNG per frame (reuse the
multi-frame machinery) or warn explicitly that only frame 1 was replaced.

### 9. Stale art preview survives session reset — `index.html:1456` (CONFIRMED)

`resetSession` clears caches but not `pendingArt`/the art panel. After
dropping replacement archives, "Apply artwork" is still enabled with art
quantized against the **previous** session's palette, and clicking it writes
those wrong-palette bytes into the new session's items.

**Fix:** call `resetArtPreview()` from `resetSession()`.

### 10. MUS header channel count can undercount — `index.html:951` (CONFIRMED)

`midiToMus` writes the header channel count from `noteChannels.size` (MIDI
channels with note-ons), but `mapChannel` also allocates MUS channels for
controller/pitch-bend-only channels. A MIDI with CC events on channel 0 (no
notes) and notes on channel 1 allocates MUS channels 0 and 1 but writes
`channels = 1` — a DMX player allocating voices from the header drops the
second channel's events.

**Fix:** write `nextChannel` (the number of allocated melodic channels)
instead of `noteChannels.size`.

---

## Omitted minor findings (under the 10-finding cap)

- `quantizeRgba` builds a template-string cache key per pixel — a 320×200
  import allocates/hashes 64 000 strings; an integer key (`r<<16|g<<8|b`)
  avoids it.
- `visualLayer()` (which slices arrays) runs on every `mousemove` over the
  path canvas even when no drag is active.
- `format === 2 || format > 1` in `midiToMus` — the first disjunct is
  subsumed by the second.
- Clicking an existing gun/engine marker sets `activeVisualPoint` without
  calling `drawPath()`, so the value box only appears after the next redraw;
  the box's visibility check also lacks the `< visual.count` upper bound used
  by the value refresh.

## Resolution

All ten findings and the minor cleanups were fixed in `8be6e13`. The one
check that cannot run in this repository or CI (by design, no game data is
committed) is the real-data integration suite:

```
node tests/test_editor_core.mjs <glb-dir>
```

Run it once against your own `FILE0000.GLB`–`FILE0004.GLB` after any change
to the parsers or validators, alongside a manual browser load of the
original archives.

# Devlog

The short version of how a lost 1994 level editor came back to life, in
dated milestones. Written by Alexbeav and Claude (Anthropic), who built all
of this together — the format recovery, the editor, the tools, and the
engine work. Companion repo: [raptor-enhanced](https://github.com/Alexbeav/raptor-enhanced).

## 2026-07-14 — Format recovery and first release

It started with a question: could the file formats of *Raptor: Call of the
Shadows* (1994) be recovered well enough to edit levels again? The studio's
in-house editor was lost decades ago. Reading the released DOS source and the
GPL-2 [skynettx/raptor](https://github.com/skynettx/raptor) port together, we
reconstructed the GLB archive container (with its FAT encryption), the map,
sprite-library, and destructible-tile formats, and validated everything
byte-for-byte against the shipped game data: re-saving an untouched map
reproduces the archive byte-identically. The editor shipped the same day as a
single dependency-free HTML file, published with the blessing of Raptor's
creator, Scott Host. [FORMATS.md](FORMATS.md) documents everything we
recovered.

## 2026-07-15 — From viewer to workshop

A day of rapid iteration: undo/redo histories, FLATS (destructible tile)
editing, a live map-warnings system, enemy variant grouping, rectangle
multi-select, versioned session recovery in IndexedDB, direct game-folder
saves with first-save backups, and the `.rapmod` mod format — sharing
author-created changes as hash-verified diffs with transactional import and
rollback, never redistributing game data. Music-slot editing landed too,
after verifying the engine's hard-coded eight shared soundtrack slots against
the source. Tests and CI grew alongside: fixture-independent Node and Python
suites plus Playwright browser tests, all runnable without any game data.

Community feedback started shaping the roadmap the same day — a request to
integrate MIDI conversion (thanks RetroGamer02) became the in-browser
MIDI→MUS converter.

## 2026-07-16 — The content pipeline

Phase 4 landed: PNG artwork import quantized to the game palette (replace
tiles and sprites, append multi-frame animations), visual gun-mount and
engine-flare editing, in-browser MIDI→Standard-MUS conversion pinned
byte-for-byte to midi3mus at Raptor's 70 Hz clock, and `.rapmod` v2 with
embedded artwork addressed safely by archive and item index. A multi-agent
adversarial code review found ten real defects before release — name-keyed
diffing that would break on real archives, validator regressions, undo
orphans — all fixed with regression tests ([CODE-REVIEW.md](CODE-REVIEW.md)
has the full findings).

Same day, small-screen reports from the community (1366×768 laptops) drove a
round of UI work: scrollable sidebar panels, a draggable sidebar resizer, a
tile picker that reflows to the panel width, and zoom that survives refresh.

## 2026-07-18 — Delta Sector and the Enhanced engine

The big one. A community-made **fourth campaign** — Delta Sector, nine waves
splicing terrain and enemies from all three original campaigns — went from
private experiment to public release:

- **[Raptor Enhanced](https://github.com/Alexbeav/raptor-enhanced)** (a GPL-2
  fork of the open-source port) gained engine support for a fourth sector:
  ship-computer selection, per-wave music via its own song table, save-format-
  compatible wave persistence, and a bespoke ending — all gated on data
  presence, so the engine behaves stock without it.
- The **installer was ported into this editor**: one click generates the
  patched archives in the browser, byte-identical to the Python installer
  (proven by a cross-language parity test), no dependencies.
- **Tile region copy/paste** (shift-drag, Ctrl+C/V across maps) landed for
  exactly the terrain-splicing workflow Delta is made of.
- The editor picked up full Delta awareness: the nine G4 maps edit like any
  level, music slots included.

Release day also delivered a proper bug hunt: a report of the game freezing
on load traced to the 2010/2015 Windows edition sharing the same save folder
and filenames with a different pilot format — the engine was parsing foreign
saves into garbage and corrupting memory. The fix added structural pilot
validation, a diagnostic `RAPTOR.LOG`, and bounds checks; classic 1994
pilots (DOS or Steam) now import cleanly while 2015-Edition pilots are
detected and left untouched. Three engine releases (1.1, 1.1.1, 1.1.2) and
the editor's first tagged release shipped in one day.

Along the way, reading the engine settled a 30-year-old piece of community
folklore: shields *do* recharge when you hold fire — one point per ~4.1
seconds of complete cease-fire, silently disabled on the hardest difficulty,
which each sector reaches automatically after you complete it. The myth and
the skeptics were both right.

## What this project is now

A complete, tested, legally-careful modding ecosystem for a 1994 game:
browser editor, command-line tools, a shareable patch format, an enhanced
engine, and a bonus campaign — none of it redistributing a byte of game
data, all of it built by reading thirty-year-old C with fresh eyes. Every
format documented, every codec byte-for-byte verified, every release tested
in CI.

Fly dangerous.

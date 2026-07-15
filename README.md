# Raptor Map Editor

A level and enemy editor for **Raptor: Call of the Shadows** (1994), rebuilt
from scratch ~32 years after the original in-house editor's source code was
lost. Published with the blessing of Raptor's creator, Scott Host.

The editor is **one HTML file with zero dependencies**: open `index.html` in a
browser, drop in your own game data files, and edit. Nothing is uploaded
anywhere — everything runs locally in the tab, and your original files are
never modified (saving downloads patched copies).

## What it does

- **Edit all 27 levels** — paint tiles (with destructible-tile markers and a
  right-click eyedropper), place/move/delete enemies, set per-enemy difficulty
  (easy / medium / hard / secret), full-level view. Selecting a placed enemy
  also makes that type the active choice for repeated placement.
- **Change soundtrack slots** — choose another built-in track or import a DMX
  `.MUS` file. The original engine hard-codes eight shared slots, so the editor
  shows every other level affected before a slot is changed.
- **Edit the enemies themselves** — every enemy definition in the game: hit
  points, bounty, speed, fire rate, flight AI type, and the **flight path** on
  a visual waypoint canvas (drag, click to add, right-click to delete).
  Select a placed enemy and its flight path overlays the map.
- **Create new enemies** — *Duplicate* appends a copy as a brand-new entry.
  The engine derives the enemy count from the data size, so new enemies work
  in the **unmodified original game** — DOS, Steam, or the 2015 Edition.
- **Round-trip safe** — every file format was validated byte-for-byte against
  the shipped data; re-saving an untouched map reproduces the archive
  byte-identically. The engine's spawn-order invariant (see
  [FORMATS.md](FORMATS.md)) is enforced automatically.

## Quick start

1. Open `index.html` in any modern browser.
2. Drag `FILE0000.GLB`–`FILE0004.GLB` from your Raptor install onto the page
   (v1.2+ data; the shareware's `FILE0000`+`FILE0001` also works).
3. Pick a map. The **?** button covers the rest.
4. **Download GLB** saves patched copies. Back up your originals, drop the
   patched files into your game folder, and play.

**Which game version?** The classic 1994 game and the *2015 Edition* ship
the same `file0000`–`file0004.glb` (SHA-256 identical), so the editor reads
either. For **playing** your edits, use the 1994 engine — DOS Raptor under
DOSBox, the Steam 1994 release, or the
[open-source port](https://github.com/skynettx/raptor) — where patched GLBs
are confirmed working. The 2015 Edition is a different engine and is
untested with modified files (its extra `file0005/0006.glb` aren't used by
this editor). Work-in-progress or modified GLBs from newer builds are not
supported.

## Command-line tools

`tools/` contains companion format functionality as scriptable Python (3.10+;
`pip install -r requirements.txt` installs Pillow for the graphics commands):

```
python tools/glbtool.py list      <FILE000n.GLB>          # inspect archives
python tools/glbtool.py verify    <FILE000n.GLB>          # prove lossless round trip
python tools/glbtool.py map2json  <datadir> MAP1G1        # level  <-> editable JSON
python tools/glbtool.py json2map  <datadir> map1g1.json
python tools/glbtool.py lib2json  <datadir> 1             # enemies <-> editable JSON
python tools/glbtool.py json2lib  <datadir> lib.json
python tools/glbtool.py pic2png   <datadir> SHIP01G1_PIC  # any graphic -> PNG
python tools/glbtool.py png2pic   <datadir> art.png --name MYSHIP_PIC   # PNG -> game
python tools/render_map.py <datadir> --all                # render all 27 levels to PNG
```

`png2pic` quantizes to the game palette and encodes either graphic format;
the encoder reproduces the original tool's output byte-for-byte on
re-encoded sprites.

## Tests

Fixture-independent codec and validation tests run without game data:

```
node tests/test_editor_core.mjs
python -m unittest discover -s tests -p "test_*.py"
```

Pass a GLB directory to the Node test to additionally run the proprietary-data
round-trip checks: `node tests/test_editor_core.mjs <datadir>`.

## Legality

This repository contains **no game data and no game code** — you supply your
own GLB files from a copy of the game you own
([Steam](https://store.steampowered.com/app/336060/),
[GOG](https://www.gog.com/game/raptor_call_of_the_shadows_2015_edition)).
The file formats were reverse-engineered from the released DOS source code
and the GPL-2 [skynettx/raptor](https://github.com/skynettx/raptor) port,
then validated against the shipped data. Don't redistribute game files or
archives containing them; share your levels as JSON exports instead.

## Credits

- **Scott Host** — for Raptor, the released source, and the go-ahead to
  publish. Buy his games: [mking.com](https://www.mking.com).
- Built by **Alexbeav** with **Claude (Fable)**, Anthropic's AI agent — the
  format recovery, the editor, and these tools came out of one long session
  of reading 1994 C code together.
- **nukeykt** and **skynettx** — the reverse-engineered source port that made
  format validation possible.
- The [DOS Game Modding Wiki](https://moddingwiki.shikadi.net/wiki/Raptor) —
  prior GLB format documentation.

MIT licensed. See [FORMATS.md](FORMATS.md) for the complete file-format
reference recovered during this project.

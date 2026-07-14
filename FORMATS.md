# Raptor: Call of the Shadows — file format reference

Recovered from the released DOS source code and the
[skynettx/raptor](https://github.com/skynettx/raptor) port, and validated
byte-for-byte against the shipped v1.2 GLB files (all five archives re-encode
byte-identically through the tools in this repo). All integers are
little-endian. Struct names follow the original source (`MAP.H`, `TILE.C`,
`ENEMY.C`, `GLBAPI.C`).

## GLB container

Data ships as `FILE0000.GLB`–`FILE0004.GLB`. A file allocation table of
28-byte entries starts at offset 0:

```
u32  flags      bit 0 = item data is encrypted
u32  offset     absolute file offset of the item data
u32  size       item size in bytes (0 = label/marker item)
char name[16]   NUL-terminated ASCII
```

Entry 0 is a header whose `offset` field holds the item count; item entries
follow. **FAT entries are always encrypted** (each 28-byte entry
independently); item data is encrypted only when flag bit 0 is set.

Cipher (shared by FAT and data, symmetric add/subtract):

```
key   = "32768GLB"
kidx  = 0x19 % 8          (= 1)
prev  = key[kidx]
decrypt: out[i] = (in[i] - key[kidx] - prev) & 0xFF ; prev = in[i] ; kidx = (kidx+1) % 8
encrypt: prev   = (in[i] + key[kidx] + prev) & 0xFF ; out[i] = prev ; ...
```

**Item IDs are positional**: `(filenum << 16) | index`. Name lookups scan
files in number order. Because tile graphics are addressed as *marker item +
1 + index* (see below), item order is load-bearing — rebuild archives with
order preserved. Appending new items at the end of a file is safe.

## Levels (`MAP{1-9}G{1-3}_MAP`)

27 levels: Bravo Sector (G1), Tango Sector (G2), Outer Regions (G3 — waves
6–9 stored in FILE0004). `MAZELEVEL` layout:

```
u32  sizerec               total record size
u32  spriteoff             offset of the sprite list (always 5412)
i32  numsprites
struct { i16 flats; i16 fgame; } map[150*9]    row-major, 9 cols x 150 rows
struct CSPRITE sprites[numsprites]             24 bytes each, see below
```

The level scrolls bottom-up: row 149 is where play starts, row 0 is the end.
Each cell's tile graphic is GLB item `STARTG{fgame+1}TILES + 1 + flats`
(tiles are 32x32; a level is 288x4800 px). Cells may reference any of the
four tile banks via `fgame`.

### CSPRITE (enemy/object placements)

```
i32  link     spawn-group chain: 0 = next entry spawns with this one,
              1 or -1 = end of group
i32  slib     index into SPRITE{game+1}_ITM
i32  x, y     tile-grid position (x 0-8, y 0-149)
i32  game     which sprite bank (0-3)
u32  level    difficulty gate: 3=easy 4=medium 5=hard, 1/2/6=secrets;
              anything else never spawns. Easy spawns on all difficulties,
              medium on veteran+, hard on elite only.
```

### The spawn-order invariant (important!)

The engine spawns enemies with a **forward-only cursor** over the sprite
list (`ENEMY_Think`): a *group* is a run of consecutive entries chained
until one has `link` = 1 or -1, and the whole group spawns when the scroll
row reaches the **head entry's** `y`. Therefore group heads must appear in
**descending-y order**, and heads must be **<= 139** (scrolling starts at
row 139). Violate either and the cursor stalls: every later entry silently
never spawns. All 27 shipped maps satisfy this; the tools here re-sort
automatically (a no-op on original data).

## Enemy definitions (`SPRITE{1-4}_ITM`)

An array of 528-byte `SPRITE` records; **the engine derives the count from
the item size**, so appending records adds enemies without any code change.
Layout:

```
char iname[16]        GLB item name of the first graphic frame (looked up by name)
i32  item, bonus, exptype, shotspace, ground, suck, frame_rate, num_frames,
     countdown, rewind, animtype, shadow, bossflag, hits, money, shootstart,
     shootcnt, shootframe, movespeed, numflight, repos, flighttype,
     numguns, numengs, sfx, song                          (26 x i32)
i16  shoot_type[24], engx[24], engy[24], englx[24], shootx[24], shooty[24]
i16  flightx[30], flighty[30]
```

`flighttype`: 0 repeat, 1 linear, 2 kamikaze, 3 ground, 4 ground-left,
5 ground-right. For air types, `flightx/y[i]` are **offsets from the spawn
anchor** (spawn column, screen y~100); `repeat` ping-pongs between the last
waypoint and index `repos`; `linear` flies the list once and leaves;
`kamikaze` flies the list then chases the player. Ground types ignore
waypoints and scroll with the terrain.

## Tile properties (`FLATSG{1-4}_ITM`)

One 8-byte record per tile in the bank, same order as the tile items:

```
i32  linkflat   tile index shown after destruction (== own index: indestructible)
i16  bonus      hit points / bonus id
i16  bounty     money awarded
```

## Graphics (`GFX_PIC`)

20-byte header `{ i32 type, opt1, opt2, width, height }`, then:

- **type 1 (GPIC)** — raw 8bpp palette indices, `width*height` bytes.
  Tiles use header opts `(1, 0)`.
- **type 0 (GSPRITE)** — sparse segments for transparency:
  `{ i32 x, y, offset, length }` + `length` pixel bytes, repeated, terminated
  by `offset == -1`. `offset` is the precomputed VGA screen offset
  `y*320 + x`. Header opts are `(0, height)`. Enemy/object graphics must be
  GSPRITE (the engine draws them with `GFX_PutSprite`).

Palette: `PALETTE_DAT` (768 bytes, 6-bit VGA — shift left 2 for 8-bit RGB).
Indices 254/255 are reserved at runtime (engine/shot flicker colors) and 0
is conventionally transparent; quantize imported art to indices 1–253.

## Everything else is items too

Menus/windows (`*_SWD`, interpreted by `SWDAPI`), music (`*_MUS`), fonts
(`*_FNT`: `{ i32 height; i16 charofs[256]; i8 width[256]; }` + glyphs),
digital SFX, encrypted text, and pilot photos (`PILOT_AGX` — a distinct
animation format, not yet documented here).

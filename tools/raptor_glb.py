"""
raptor_glb.py - Library for Raptor: Call of the Shadows data files.

Formats implemented from the released game source (original-dos/SOURCE) and the
skynettx/nukeykt port (modern-port/src/glbapi.cpp). See FORMATS.md at the repo
root for the validated format documentation.

Covers:
  * GLB container: FAT parse/build, item en/decryption (key "32768GLB", seed 0x19)
  * MAZELEVEL map items (MAP.H)          -> dict / bytes
  * SPRITE libraries (SPRITEn_ITM)       -> dict
  * FLATS tables (FLATSGn_ITM)           -> dict
  * GFX_PIC graphics (GPIC raw / GSPRITE segmented) -> (w, h, pixels, mask)
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path

KEY = b"32768GLB"
SEED = 0x19

FAT_ENTRY = 28          # sizeof(KEYFILE)
FLAG_ENCODED = 0x1      # GLB_ENCODED
MAP_COLS = 9
MAP_ROWS = 150
MAP_SIZE = MAP_ROWS * MAP_COLS
MAZELEVEL_SIZE = 12 + MAP_SIZE * 4
CSPRITE_SIZE = 24
SPRITE_SIZE = 528       # sizeof(SPRITE), MAP.H:95 (validated: SPRITE1_ITM = 131*528)
FLATS_SIZE = 8          # sizeof(FLATS),  MAP.H:52
MAX_GUNS = 24
MAX_FLIGHT = 30

# CSPRITE.level values as authored (ENEMY.C:169-198). Anything else = never spawns.
LEVEL_NAMES = {1: "secret1", 2: "secret2", 3: "easy", 4: "medium", 5: "hard", 6: "secret3"}


# --------------------------------------------------------------------------
# Cipher (glbapi.cpp GLB_EnCrypt/GLB_DeCrypt)
# --------------------------------------------------------------------------

def decrypt(buf: bytes) -> bytes:
    kidx = SEED % len(KEY)
    prev = KEY[kidx]
    out = bytearray(len(buf))
    for i, b in enumerate(buf):
        out[i] = (b - KEY[kidx] - prev) % 256
        prev = b
        kidx = (kidx + 1) % len(KEY)
    return bytes(out)


def encrypt(buf: bytes) -> bytes:
    kidx = SEED % len(KEY)
    prev = KEY[kidx]
    out = bytearray(len(buf))
    for i, b in enumerate(buf):
        prev = (b + KEY[kidx] + prev) % 256
        out[i] = prev
        kidx = (kidx + 1) % len(KEY)
    return bytes(out)


# --------------------------------------------------------------------------
# GLB container
# --------------------------------------------------------------------------

@dataclass
class GlbItem:
    flags: int
    name: str
    data: bytes            # always decrypted in memory

    @property
    def encrypted(self) -> bool:
        return bool(self.flags & FLAG_ENCODED)

    @property
    def is_label(self) -> bool:
        return len(self.data) == 0


@dataclass
class GlbFile:
    items: list[GlbItem] = field(default_factory=list)

    @classmethod
    def parse(cls, data: bytes) -> "GlbFile":
        if len(data) < FAT_ENTRY:
            raise ValueError("GLB is shorter than its 28-byte header")
        hdr = decrypt(data[:FAT_ENTRY])
        _, count, _ = struct.unpack_from("<III", hdr)
        fat_size = FAT_ENTRY * (count + 1)
        if count > 0xFFFF or fat_size > len(data):
            raise ValueError(f"invalid GLB item count {count}")
        items = []
        for i in range(count):
            e = decrypt(data[FAT_ENTRY * (i + 1): FAT_ENTRY * (i + 2)])
            flags, offset, size = struct.unpack_from("<III", e)
            if offset < fat_size or offset + size > len(data):
                raise ValueError(f"GLB item {i} points outside the archive")
            name = e[12:28].split(b"\0")[0].decode("ascii", "replace")
            raw = data[offset: offset + size]
            if flags & FLAG_ENCODED:
                raw = decrypt(raw)
            items.append(GlbItem(flags, name, raw))
        return cls(items)

    def build(self) -> bytes:
        count = len(self.items)
        fat = bytearray()
        fat += encrypt(struct.pack("<III16x", 0, count, 0))
        offset = FAT_ENTRY * (count + 1)
        blobs = []
        for it in self.items:
            name = it.name.encode("ascii")
            if len(name) > 15:
                raise ValueError(f"item name too long: {it.name!r}")
            fat += encrypt(struct.pack("<III16s", it.flags, offset, len(it.data), name))
            blob = encrypt(it.data) if it.encrypted else it.data
            blobs.append(blob)
            offset += len(blob)
        return bytes(fat) + b"".join(blobs)

    def index_of(self, name: str) -> int:
        for i, it in enumerate(self.items):
            if it.name == name:
                return i
        return -1


class GlbSet:
    """All FILE000n.GLB archives in a directory; name lookup mirrors GLB_GetItemID
    (files searched in number order; item handle = (filenum << 16) | index)."""

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)
        self.files: dict[int, GlbFile] = {}
        for num in range(16):
            for pat in (f"FILE{num:04}.GLB", f"file{num:04}.glb"):
                p = self.directory / pat
                if p.exists():
                    self.files[num] = GlbFile.parse(p.read_bytes())
                    break
        if not self.files:
            raise FileNotFoundError(f"no FILE000n.GLB archives in {self.directory}")

    def item_id(self, name: str) -> int:
        for num in sorted(self.files):
            idx = self.files[num].index_of(name)
            if idx >= 0:
                return (num << 16) | idx
        return -1

    def by_id(self, item_id: int) -> GlbItem:
        return self.files[item_id >> 16].items[item_id & 0xFFFF]

    def by_name(self, name: str) -> GlbItem:
        item_id = self.item_id(name)
        if item_id < 0:
            raise KeyError(name)
        return self.by_id(item_id)


# --------------------------------------------------------------------------
# Map items (MAZELEVEL + CSPRITE[], MAP.H:59-71 / 134-142)
# --------------------------------------------------------------------------

def parse_map(data: bytes) -> dict:
    if len(data) < MAZELEVEL_SIZE:
        raise ValueError("MAZELEVEL item is truncated")
    sizerec, spriteoff, numsprites = struct.unpack_from("<IIi", data)
    if numsprites < 0:
        raise ValueError("MAZELEVEL has a negative sprite count")
    expected = MAZELEVEL_SIZE + numsprites * CSPRITE_SIZE
    if sizerec != len(data) or spriteoff != MAZELEVEL_SIZE or expected != len(data):
        raise ValueError(f"not a MAZELEVEL item (sizerec={sizerec}, spriteoff={spriteoff})")
    cells = struct.unpack_from(f"<{MAP_SIZE * 2}h", data, 12)
    tiles = [
        [
            {"flats": cells[(r * MAP_COLS + c) * 2], "fgame": cells[(r * MAP_COLS + c) * 2 + 1]}
            for c in range(MAP_COLS)
        ]
        for r in range(MAP_ROWS)
    ]
    sprites = []
    for i in range(numsprites):
        link, slib, x, y, game, level = struct.unpack_from("<iiiiiI", data, spriteoff + i * CSPRITE_SIZE)
        sprites.append({
            "link": link, "slib": slib, "x": x, "y": y, "game": game,
            "level": level, "level_name": LEVEL_NAMES.get(level, "unused"),
        })
    return {"rows": MAP_ROWS, "cols": MAP_COLS, "tiles": tiles, "sprites": sprites}


def _integer(value, label: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{label} must be an integer from {low} to {high}")
    return value


def validate_map(m: dict) -> dict:
    """Validate editable JSON before it can become a game record."""
    tiles = m.get("tiles")
    sprites = m.get("sprites")
    if not isinstance(tiles, list) or len(tiles) != MAP_ROWS:
        raise ValueError(f"tiles must contain exactly {MAP_ROWS} rows")
    for r, row in enumerate(tiles):
        if not isinstance(row, list) or len(row) != MAP_COLS:
            raise ValueError(f"tile row {r} must contain exactly {MAP_COLS} cells")
        for c, cell in enumerate(row):
            if not isinstance(cell, dict):
                raise ValueError(f"tile {r},{c} must be an object")
            _integer(cell.get("flats"), f"tile {r},{c} flats", -32768, 32767)
            _integer(cell.get("fgame"), f"tile {r},{c} fgame", 0, 3)
    if not isinstance(sprites, list):
        raise ValueError("sprites must be an array")
    for i, s in enumerate(sprites):
        if not isinstance(s, dict):
            raise ValueError(f"sprite {i} must be an object")
        _integer(s.get("link"), f"sprite {i} link", -1, 1)
        _integer(s.get("slib"), f"sprite {i} slib", 0, 0x7FFFFFFF)
        _integer(s.get("x"), f"sprite {i} x", 0, MAP_COLS - 1)
        _integer(s.get("y"), f"sprite {i} y", 0, MAP_ROWS - 1)
        _integer(s.get("game"), f"sprite {i} game", 0, 3)
        _integer(s.get("level"), f"sprite {i} level", 0, 0xFFFFFFFF)
    if sprites and sprites[-1]["link"] not in (1, -1):
        raise ValueError("the final sprite must end its spawn group (link 1 or -1)")
    for group in spawn_groups(sprites):
        if group[0]["y"] > 139:
            raise ValueError("spawn-group heads must have y <= 139")
    return m


def build_map(m: dict) -> bytes:
    validate_map(m)
    sprites = m["sprites"]
    size = MAZELEVEL_SIZE + len(sprites) * CSPRITE_SIZE
    out = bytearray(struct.pack("<III", size, MAZELEVEL_SIZE, len(sprites)))
    for row in m["tiles"]:
        for cell in row:
            out += struct.pack("<hh", cell["flats"], cell["fgame"])
    for s in sprites:
        out += struct.pack("<iiiiiI", s["link"], s["slib"], s["x"], s["y"], s["game"], s["level"])
    return bytes(out)


def spawn_groups(sprites: list[dict]) -> list[list[dict]]:
    """Split the CSPRITE list into spawn groups: consecutive entries chained
    until one has link 1 or -1 (enemy.cpp:693-707)."""
    groups, g = [], []
    for s in sprites:
        g.append(s)
        if s["link"] in (1, -1):
            groups.append(g)
            g = []
    if g:
        groups.append(g)
    return groups


def normalize_spawn_order(sprites: list[dict]) -> list[dict]:
    """Restore the engine's spawn invariant. The spawner walks the CSPRITE list
    with a forward-only cursor (enemy.cpp:691): a group spawns when the scroll
    row reaches its HEAD's y, so group heads must be in descending-y order and
    <= 139 (scrolling starts at row 139) or the cursor stalls and nothing after
    it ever spawns. Stable-sorts groups by head y; all 27 original maps already
    satisfy the invariant, so normalizing them is a byte-identical no-op."""
    groups = spawn_groups(sprites)
    groups.sort(key=lambda g: -g[0]["y"])
    return [s for g in groups for s in g]


# --------------------------------------------------------------------------
# SPRITE library (MAP.H:95-132) and FLATS (MAP.H:52-57)
# --------------------------------------------------------------------------

_SPRITE_INTS = (
    "item", "bonus", "exptype", "shotspace", "ground", "suck", "frame_rate",
    "num_frames", "countdown", "rewind", "animtype", "shadow", "bossflag",
    "hits", "money", "shootstart", "shootcnt", "shootframe", "movespeed",
    "numflight", "repos", "flighttype", "numguns", "numengs", "sfx", "song",
)


def parse_sprite_lib(data: bytes) -> list[dict]:
    if len(data) % SPRITE_SIZE:
        raise ValueError(f"sprite lib size {len(data)} not a multiple of {SPRITE_SIZE}")
    out = []
    for base in range(0, len(data), SPRITE_SIZE):
        rec = data[base: base + SPRITE_SIZE]
        s = {"iname": rec[:16].split(b"\0")[0].decode("ascii", "replace")}
        s.update(zip(_SPRITE_INTS, struct.unpack_from("<26i", rec, 16)))
        shorts = struct.unpack_from(f"<{6 * MAX_GUNS + 2 * MAX_FLIGHT}h", rec, 120)
        g = MAX_GUNS
        s["shoot_type"], s["engx"], s["engy"], s["englx"], s["shootx"], s["shooty"] = (
            list(shorts[i * g:(i + 1) * g]) for i in range(6)
        )
        s["flightx"] = list(shorts[6 * g: 6 * g + MAX_FLIGHT])
        s["flighty"] = list(shorts[6 * g + MAX_FLIGHT:])
        out.append(s)
    return out


def build_sprite_lib(lib: list[dict]) -> bytes:
    """Inverse of parse_sprite_lib. Appending records is safe: the engine
    derives the entry count from the item size (enemy.cpp:259)."""
    out = bytearray(len(lib) * SPRITE_SIZE)
    for r, s in enumerate(lib):
        base = r * SPRITE_SIZE
        try:
            name = s["iname"].encode("ascii")
        except (AttributeError, UnicodeEncodeError) as exc:
            raise ValueError(f"sprite {r} iname must be ASCII") from exc
        if not name or len(name) > 15:
            raise ValueError(f"sprite {r} iname must be 1-15 ASCII characters")
        out[base: base + len(name)] = name
        ints = [_integer(s.get(f), f"sprite {r} {f}", -0x80000000, 0x7FFFFFFF)
                for f in _SPRITE_INTS]
        struct.pack_into("<26i", out, base + 16, *ints)
        for field in ("shoot_type", "engx", "engy", "englx", "shootx", "shooty"):
            if not isinstance(s.get(field), list) or len(s[field]) != MAX_GUNS:
                raise ValueError(f"sprite {r} {field} must contain {MAX_GUNS} values")
        for field in ("flightx", "flighty"):
            if not isinstance(s.get(field), list) or len(s[field]) != MAX_FLIGHT:
                raise ValueError(f"sprite {r} {field} must contain {MAX_FLIGHT} values")
        shorts = (s["shoot_type"] + s["engx"] + s["engy"] + s["englx"]
                  + s["shootx"] + s["shooty"] + s["flightx"] + s["flighty"])
        shorts = [_integer(v, f"sprite {r} short value", -32768, 32767) for v in shorts]
        struct.pack_into(f"<{len(shorts)}h", out, base + 120, *shorts)
    return bytes(out)


def parse_flats(data: bytes) -> list[dict]:
    if len(data) % FLATS_SIZE:
        raise ValueError(f"flats size {len(data)} not a multiple of {FLATS_SIZE}")
    return [
        dict(zip(("linkflat", "bonus", "bounty"), struct.unpack_from("<ihh", data, o)))
        for o in range(0, len(data), FLATS_SIZE)
    ]


def build_flats(flats: list[dict]) -> bytes:
    """Inverse of parse_flats with strict field and integer validation."""
    if not isinstance(flats, list):
        raise ValueError("flats table must be a list")
    out = bytearray(len(flats) * FLATS_SIZE)
    for i, flat in enumerate(flats):
        if not isinstance(flat, dict):
            raise ValueError(f"flat {i} must be an object")
        try:
            linkflat = _integer(flat["linkflat"], f"flat {i} linkflat", -0x80000000, 0x7FFFFFFF)
            bonus = _integer(flat["bonus"], f"flat {i} bonus", -32768, 32767)
            bounty = _integer(flat["bounty"], f"flat {i} bounty", -32768, 32767)
        except KeyError as exc:
            raise ValueError(f"flat {i} is missing {exc.args[0]}") from exc
        struct.pack_into("<ihh", out, i * FLATS_SIZE, linkflat, bonus, bounty)
    return bytes(out)


# --------------------------------------------------------------------------
# Graphics (GFX_PIC header + GPIC raw / GSPRITE segments, gfxapi.h/.cpp)
# --------------------------------------------------------------------------

GTYPE_SPRITE = 0
GTYPE_PIC = 1


def parse_pic(data: bytes) -> tuple[int, int, bytes, bytes]:
    """Decode a GFX_PIC item -> (width, height, pixels, mask). pixels is w*h
    palette indices; mask is w*h with 1 = opaque."""
    gtype, _, _, w, h = struct.unpack_from("<5i", data)
    if gtype == GTYPE_PIC:
        px = data[20: 20 + w * h]
        return w, h, px, b"\x01" * (w * h)
    if gtype == GTYPE_SPRITE:
        px = bytearray(w * h)
        mask = bytearray(w * h)
        pos = 20
        while pos + 16 <= len(data):
            x, y, offset, length = struct.unpack_from("<4i", data, pos)
            if offset == -1:
                break
            pos += 16
            run = data[pos: pos + length]
            pos += length
            if 0 <= y < h:
                for j, b in enumerate(run):
                    if 0 <= x + j < w:
                        px[y * w + x + j] = b
                        mask[y * w + x + j] = 1
        return w, h, bytes(px), bytes(mask)
    raise ValueError(f"unknown GFX_TYPE {gtype}")


RESERVED_INDICES = frozenset({0, 254, 255})   # transparent, ENGINE_COLOR, SHOT_COLOR


def nearest_palette_index(palette, r: int, g: int, b: int) -> int:
    """Closest usable palette index (reserved indices excluded)."""
    best, best_d = 1, 1 << 30
    for i, (pr, pg, pb) in enumerate(palette):
        if i in RESERVED_INDICES:
            continue
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < best_d:
            best, best_d = i, d
            if d == 0:
                break
    return best


def quantize_rgba(w: int, h: int, rgba: bytes, palette) -> tuple[bytes, bytes]:
    """RGBA bytes -> (palette indices, opacity mask). Alpha >= 128 is opaque.
    Repeated colors are memoized, so clean pixel art quantizes fast."""
    cache: dict[tuple, int] = {}
    px = bytearray(w * h)
    mask = bytearray(w * h)
    for i in range(w * h):
        r, g, b, a = rgba[i * 4: i * 4 + 4]
        if a < 128:
            continue
        key = (r, g, b)
        if key not in cache:
            cache[key] = nearest_palette_index(palette, r, g, b)
        px[i] = cache[key]
        mask[i] = 1
    return bytes(px), bytes(mask)


def encode_pic(w: int, h: int, pixels: bytes, mask: bytes, gtype: int) -> bytes:
    """Inverse of parse_pic. GPIC (tiles/UI): raw 8bpp, header opts (1, 0) as in
    all shipped tiles. GSPRITE (enemies/objects): opaque runs as segments with
    offset = y*320+x (VGA screen offset), terminated by offset=len=-1, header
    opts (0, h) as in all shipped sprites."""
    if gtype == GTYPE_PIC:
        return struct.pack("<5i", GTYPE_PIC, 1, 0, w, h) + bytes(
            pixels[i] if mask[i] else 0 for i in range(w * h))
    if gtype != GTYPE_SPRITE:
        raise ValueError(f"unknown GFX_TYPE {gtype}")
    out = bytearray(struct.pack("<5i", GTYPE_SPRITE, 0, h, w, h))
    for y in range(h):
        x = 0
        while x < w:
            if not mask[y * w + x]:
                x += 1
                continue
            run = x
            while run < w and mask[y * w + run]:
                run += 1
            out += struct.pack("<4i", x, y, y * 320 + x, run - x)
            out += pixels[y * w + x: y * w + run]
            x = run
    out += struct.pack("<4i", 0, 0, -1, -1)
    return bytes(out)


def load_palette(glbs: GlbSet) -> list[tuple[int, int, int]]:
    """PALETTE_DAT: 256 x 3 bytes of 6-bit VGA values (i_video.cpp:854 shifts <<2)."""
    raw = glbs.by_name("PALETTE_DAT").data
    return [(raw[i] << 2, raw[i + 1] << 2, raw[i + 2] << 2) for i in range(0, 768, 3)]


def tileset_start(glbs: GlbSet, fgame: int) -> int:
    """First tile item id for tileset n (TILE.C:210: id of STARTGnTILES marker + 1)."""
    return glbs.item_id(f"STARTG{fgame + 1}TILES") + 1


def sprite_lib(glbs: GlbSet, game: int) -> list[dict]:
    return parse_sprite_lib(glbs.by_name(f"SPRITE{game + 1}_ITM").data)

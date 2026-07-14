"""
render_map.py - Render Raptor levels to PNG (Phase 1 viewer).

Composites the full 9x150 tile grid (288 x 4800 px) from the game tilesets and
overlays every placed sprite: the actual enemy graphic, a difficulty-colored
box, and a name label.

Difficulty outline colors:
  green = easy    yellow = medium    red = hard    cyan = secret    gray = unused

Usage:
  python render_map.py <data-dir> MAP1G1 [MAP2G1 ...]   render specific maps
  python render_map.py <data-dir> --all                 render every map found
  options: -o OUTDIR (default ..\\renders)  --no-labels  --no-sprites
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from raptor_glb import (
    MAP_COLS, MAP_ROWS, GlbSet, load_palette, parse_map, parse_pic,
    sprite_lib, tileset_start,
)

TILE = 32
LEVEL_COLORS = {
    "easy": (60, 220, 60), "medium": (255, 210, 40), "hard": (255, 60, 60),
    "secret1": (60, 220, 220), "secret2": (60, 220, 220), "secret3": (60, 220, 220),
    "unused": (128, 128, 128),
}


class Renderer:
    def __init__(self, glbs: GlbSet):
        self.glbs = glbs
        self.palette = load_palette(glbs)
        self.starts = {}          # fgame -> first tile item id
        self.libs = {}            # game -> parsed SPRITEn_ITM
        self.pic_cache = {}       # item id -> RGBA Image
        try:
            self.font = ImageFont.load_default(size=10)
        except TypeError:
            self.font = ImageFont.load_default()

    def pic_rgba(self, item_id: int) -> Image.Image:
        if item_id not in self.pic_cache:
            w, h, px, mask = parse_pic(self.glbs.by_id(item_id).data)
            img = Image.new("RGBA", (w, h))
            img.putdata([
                (*self.palette[p], 255) if m else (0, 0, 0, 0)
                for p, m in zip(px, mask)
            ])
            self.pic_cache[item_id] = img
        return self.pic_cache[item_id]

    def tile_layer(self, level: dict) -> Image.Image:
        img = Image.new("RGBA", (MAP_COLS * TILE, MAP_ROWS * TILE))
        for r, row in enumerate(level["tiles"]):
            for c, cell in enumerate(row):
                fgame = cell["fgame"]
                if fgame not in self.starts:
                    self.starts[fgame] = tileset_start(self.glbs, fgame)
                img.paste(self.pic_rgba(self.starts[fgame] + cell["flats"]), (c * TILE, r * TILE))
        return img

    def draw_sprites(self, img: Image.Image, level: dict, labels: bool):
        draw = ImageDraw.Draw(img)
        # ground objects first so air units overlap them, matching game layering
        order = sorted(range(len(level["sprites"])),
                       key=lambda i: not self._libentry(level["sprites"][i]).get("ground", 0))
        for i in order:
            s = level["sprites"][i]
            entry = self._libentry(s)
            x, y = s["x"] * TILE, s["y"] * TILE
            gfx_id = self.glbs.item_id(entry["iname"]) if entry else -1
            if gfx_id >= 0:
                pic = self.pic_rgba(gfx_id)
                img.alpha_composite(pic, (max(0, x), max(0, y)))
                box = (x, y, min(x + pic.width, img.width) - 1, y + pic.height - 1)
            else:
                box = (x, y, x + TILE - 1, y + TILE - 1)
            draw.rectangle(box, outline=LEVEL_COLORS[s["level_name"]], width=1)
            if labels:
                name = re.sub(r"(G\d)?_(PIC|BLK)$", "", entry["iname"]) if entry else f"?slib{s['slib']}"
                tag = f"{name} {s['level_name'][0].upper()}"
                tx, ty = box[0] + 1, box[3] + 1
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    draw.text((tx + dx, ty + dy), tag, font=self.font, fill=(0, 0, 0))
                draw.text((tx, ty), tag, font=self.font, fill=LEVEL_COLORS[s["level_name"]])

    def _libentry(self, s: dict) -> dict:
        game = s["game"]
        if game not in self.libs:
            self.libs[game] = sprite_lib(self.glbs, game)
        lib = self.libs[game]
        return lib[s["slib"]] if 0 <= s["slib"] < len(lib) else {}

    def render(self, mapname: str, labels=True, sprites=True) -> Image.Image:
        level = parse_map(self.glbs.by_name(mapname).data)
        img = self.tile_layer(level)
        if sprites:
            self.draw_sprites(img, level, labels)
        return img


def all_map_names(glbs: GlbSet) -> list[str]:
    names = []
    for num in sorted(glbs.files):
        names += [it.name for it in glbs.files[num].items
                  if re.fullmatch(r"MAP\d+G\d_MAP", it.name)]
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("datadir", help="directory containing FILE000n.GLB")
    ap.add_argument("maps", nargs="*", help="map names, e.g. MAP1G1")
    ap.add_argument("--all", action="store_true", help="render every map in the archives")
    ap.add_argument("-o", "--outdir", default=str(Path(__file__).parent.parent / "renders"))
    ap.add_argument("--no-labels", action="store_true")
    ap.add_argument("--no-sprites", action="store_true")
    args = ap.parse_args()

    glbs = GlbSet(args.datadir)
    rend = Renderer(glbs)
    names = all_map_names(glbs) if args.all else \
        [m.upper().removesuffix("_MAP") + "_MAP" for m in args.maps]
    if not names:
        ap.error("give map names or --all")

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for name in names:
        img = rend.render(name, labels=not args.no_labels, sprites=not args.no_sprites)
        out = outdir / f"{name.removesuffix('_MAP')}.png"
        img.save(out)
        print(f"{name} -> {out}")


if __name__ == "__main__":
    main()

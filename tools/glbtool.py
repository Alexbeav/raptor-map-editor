"""
glbtool.py - CLI for Raptor GLB archives (Phase 0 toolkit).

Commands:
  list <glb-file-or-dir>              List items (id, flags, size, name)
  verify <glb-file>                   Parse + rebuild, check byte-identical round trip
  extract <glb-file> [-o DIR]         Dump every item to DIR (default: <name>.extracted/)
  map2json <data-dir> <MAPnGn> [-o F] Export a level to editable JSON
  json2map <data-dir> <json> [-o F]   Rebuild the map item and write a patched GLB
  sprites <data-dir> <game 1-4>       List a sector's sprite library (name, hp, money...)

Examples:
  python glbtool.py list "..\\glb files\\FILE0001.GLB"
  python glbtool.py verify "..\\glb files\\FILE0001.GLB"
  python glbtool.py map2json "..\\glb files" MAP1G1 -o map1g1.json
  python glbtool.py json2map "..\\glb files" map1g1.json -o FILE0001.GLB
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from raptor_glb import (GTYPE_PIC, GTYPE_SPRITE, GlbFile, GlbItem, GlbSet,
                        build_map, build_sprite_lib, encode_pic, load_palette,
                        normalize_spawn_order, parse_map, parse_pic,
                        parse_sprite_lib, quantize_rgba)


def cmd_list(args):
    paths = sorted(Path(args.target).glob("FILE*.GLB")) if Path(args.target).is_dir() else [Path(args.target)]
    for path in paths:
        glb = GlbFile.parse(path.read_bytes())
        print(f"\n{path.name}: {len(glb.items)} items")
        for i, it in enumerate(glb.items):
            tag = "E" if it.encrypted else " "
            lbl = "LABEL" if it.is_label else f"{len(it.data):8}"
            print(f"  {i:5}  {tag} {lbl}  {it.name}")


def cmd_verify(args):
    original = Path(args.glb).read_bytes()
    rebuilt = GlbFile.parse(original).build()
    if rebuilt == original:
        print(f"OK: {args.glb} round-trips byte-identical ({len(original)} bytes)")
    else:
        print(f"MISMATCH: rebuilt {len(rebuilt)} bytes vs original {len(original)}")
        for i, (a, b) in enumerate(zip(original, rebuilt)):
            if a != b:
                print(f"  first difference at offset {i}")
                break
        sys.exit(1)


def cmd_extract(args):
    path = Path(args.glb)
    outdir = Path(args.output or path.with_suffix(".extracted"))
    outdir.mkdir(parents=True, exist_ok=True)
    glb = GlbFile.parse(path.read_bytes())
    for i, it in enumerate(glb.items):
        if it.is_label:
            continue
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in it.name) or "UNNAMED"
        (outdir / f"{i:04}_{safe}.bin").write_bytes(it.data)
    print(f"extracted {sum(1 for i in glb.items if not i.is_label)} items to {outdir}")


def cmd_map2json(args):
    glbs = GlbSet(args.datadir)
    name = args.map.upper().removesuffix("_MAP") + "_MAP"
    m = parse_map(glbs.by_name(name).data)
    m["name"] = name
    out = Path(args.output or f"{name.lower().removesuffix('_map')}.json")
    out.write_text(json.dumps(m, indent=1))
    print(f"{name}: {len(m['sprites'])} sprites -> {out}")


def cmd_json2map(args):
    m = json.loads(Path(args.json).read_text())
    name = m["name"]
    m["sprites"] = normalize_spawn_order(m["sprites"])   # spawn-cursor invariant
    data = build_map(m)
    glbs = GlbSet(args.datadir)
    item_id = glbs.item_id(name)
    if item_id < 0:
        sys.exit(f"map {name} not found in {args.datadir}")
    filenum = item_id >> 16
    glb = glbs.files[filenum]
    glb.items[item_id & 0xFFFF].data = data
    out = Path(args.output or f"FILE{filenum:04}.GLB")
    out.write_bytes(glb.build())
    print(f"replaced {name} ({len(data)} bytes, {len(m['sprites'])} sprites) -> {out}")


def cmd_lib2json(args):
    glbs = GlbSet(args.datadir)
    lib = parse_sprite_lib(glbs.by_name(f"SPRITE{args.game}_ITM").data)
    out = Path(args.output or f"sprite{args.game}_itm.json")
    out.write_text(json.dumps({"game": args.game, "entries": lib}, indent=1))
    print(f"SPRITE{args.game}_ITM: {len(lib)} entries -> {out}")


def cmd_json2lib(args):
    j = json.loads(Path(args.json).read_text())
    game, lib = j["game"], j["entries"]
    glbs = GlbSet(args.datadir)
    item_id = glbs.item_id(f"SPRITE{game}_ITM")
    if item_id < 0:
        sys.exit(f"SPRITE{game}_ITM not found in {args.datadir}")
    filenum = item_id >> 16
    glb = glbs.files[filenum]
    glb.items[item_id & 0xFFFF].data = build_sprite_lib(lib)
    out = Path(args.output or f"FILE{filenum:04}.GLB")
    out.write_bytes(glb.build())
    print(f"replaced SPRITE{game}_ITM ({len(lib)} entries) -> {out}")


def cmd_pic2png(args):
    from PIL import Image
    glbs = GlbSet(args.datadir)
    pal = load_palette(glbs)
    w, h, px, mask = parse_pic(glbs.by_name(args.item).data)
    img = Image.new("RGBA", (w, h))
    img.putdata([(*pal[p], 255) if m else (0, 0, 0, 0) for p, m in zip(px, mask)])
    out = Path(args.output or f"{args.item.lower()}.png")
    img.save(out)
    print(f"{args.item}: {w}x{h} -> {out}")


def cmd_png2pic(args):
    from PIL import Image
    glbs = GlbSet(args.datadir)
    pal = load_palette(glbs)
    img = Image.open(args.png).convert("RGBA")
    if img.width > 320 or img.height > 200:
        sys.exit(f"too big ({img.width}x{img.height}) - the game screen is 320x200")
    px, mask = quantize_rgba(img.width, img.height, img.tobytes(), pal)
    gtype = GTYPE_SPRITE if args.type == "sprite" else GTYPE_PIC
    data = encode_pic(img.width, img.height, px, mask, gtype)

    name = args.name.upper()
    existing = glbs.item_id(name)
    if existing >= 0:                          # replace in place, order preserved
        filenum = existing >> 16
        glbs.files[filenum].items[existing & 0xFFFF].data = data
        action = "replaced"
    else:                                      # append: existing indices unchanged
        filenum = args.file
        if filenum not in glbs.files:
            sys.exit(f"FILE{filenum:04}.GLB not loaded from {args.datadir}")
        glbs.files[filenum].items.append(GlbItem(0, name, data))
        action = "appended"
    out = Path(args.output or f"FILE{filenum:04}.GLB")
    out.write_bytes(glbs.files[filenum].build())
    print(f"{action} {name} ({img.width}x{img.height} {args.type}, {len(data)} bytes) -> {out}")


def cmd_sprites(args):
    glbs = GlbSet(args.datadir)
    lib = parse_sprite_lib(glbs.by_name(f"SPRITE{args.game}_ITM").data)
    print(f"SPRITE{args.game}_ITM: {len(lib)} entries")
    print(f"  {'idx':>4} {'name':16} {'hp':>5} {'money':>6} {'frames':>6} {'guns':>4} {'waypts':>6} flight")
    ftype = ["repeat", "linear", "kami", "ground", "grndL", "grndR"]
    for i, s in enumerate(lib):
        ft = ftype[s["flighttype"]] if 0 <= s["flighttype"] < len(ftype) else "?"
        print(f"  {i:>4} {s['iname']:16} {s['hits']:>5} {s['money']:>6} "
              f"{s['num_frames']:>6} {s['numguns']:>4} {s['numflight']:>6} {ft}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("list"); p.add_argument("target"); p.set_defaults(func=cmd_list)
    p = sub.add_parser("verify"); p.add_argument("glb"); p.set_defaults(func=cmd_verify)
    p = sub.add_parser("extract"); p.add_argument("glb"); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_extract)
    p = sub.add_parser("map2json"); p.add_argument("datadir"); p.add_argument("map"); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_map2json)
    p = sub.add_parser("json2map"); p.add_argument("datadir"); p.add_argument("json"); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_json2map)
    p = sub.add_parser("sprites"); p.add_argument("datadir"); p.add_argument("game", type=int, choices=range(1, 5)); p.set_defaults(func=cmd_sprites)
    p = sub.add_parser("pic2png"); p.add_argument("datadir"); p.add_argument("item"); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_pic2png)
    p = sub.add_parser("png2pic"); p.add_argument("datadir"); p.add_argument("png"); p.add_argument("--name", required=True); p.add_argument("--type", choices=["sprite", "pic"], default="sprite"); p.add_argument("--file", type=int, default=1); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_png2pic)
    p = sub.add_parser("lib2json"); p.add_argument("datadir"); p.add_argument("game", type=int, choices=range(1, 5)); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_lib2json)
    p = sub.add_parser("json2lib"); p.add_argument("datadir"); p.add_argument("json"); p.add_argument("-o", "--output"); p.set_defaults(func=cmd_json2lib)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

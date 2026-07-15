import base64
import copy
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from raptor_glb import (  # noqa: E402
    GlbFile, GlbItem, GlbSet, apply_rapmod, build_flats, build_map,
    build_sprite_lib, decrypt, encrypt, parse_flats, parse_map,
    parse_sprite_lib, validate_mus,
)


def empty_map():
    return {
        "tiles": [[{"flats": 0, "fgame": 0} for _ in range(9)] for _ in range(150)],
        "sprites": [],
    }


class CodecTests(unittest.TestCase):
    def test_cipher_round_trip(self):
        raw = bytes((i * 37 + 11) & 255 for i in range(1000))
        self.assertEqual(decrypt(encrypt(raw)), raw)

    def test_synthetic_glb_round_trip(self):
        glb = GlbFile([
            GlbItem(0, "PLAIN", b"abc"),
            GlbItem(1, "SECRET", bytes(range(32))),
        ])
        encoded = glb.build()
        self.assertEqual(GlbFile.parse(encoded).build(), encoded)

    def test_map_round_trip(self):
        source = empty_map()
        self.assertEqual(parse_map(build_map(source))["tiles"], source["tiles"])

    def test_invalid_map_dimensions_are_rejected(self):
        source = empty_map()
        for tiles in (source["tiles"][:-1], source["tiles"] + [source["tiles"][0]]):
            with self.subTest(rows=len(tiles)), self.assertRaises(ValueError):
                build_map({**source, "tiles": tiles})

    def test_spawn_head_below_trigger_is_rejected(self):
        source = empty_map()
        source["sprites"] = [{"link": 1, "slib": 0, "x": 0, "y": 140, "game": 0, "level": 4}]
        with self.assertRaises(ValueError):
            build_map(source)

    def test_flats_round_trip_and_validation(self):
        flats = [
            {"linkflat": 0, "bonus": 0, "bounty": 0},
            {"linkflat": 0, "bonus": 25, "bounty": 150},
        ]
        self.assertEqual(parse_flats(build_flats(flats)), flats)
        with self.assertRaises(ValueError):
            build_flats([{**flats[0], "bonus": 32768}])

    def test_rapmod_cli_matches_materialized_patch_and_rejects_atomically(self):
        source_map = empty_map()
        source_lib = parse_sprite_lib(b"ENEMY\0" + bytes(528 - 6))
        source_flats = [
            {"linkflat": 0, "bonus": 0, "bounty": 0},
            {"linkflat": 1, "bonus": 0, "bounty": 0},
        ]
        base_mus = struct.pack("<4s6H", b"MUS\x1a", 1, 16, 0, 0, 0, 0) + b"\x60"
        changed_mus = struct.pack("<4s6H", b"MUS\x1a", 1, 16, 1, 0, 0, 0) + b"\x60"
        validate_mus(base_mus)
        archive = GlbFile([
            GlbItem(0, "MAP1G1_MAP", build_map(source_map)),
            GlbItem(0, "SPRITE1_ITM", build_sprite_lib(source_lib)),
            GlbItem(0, "FLATSG1_ITM", build_flats(source_flats)),
            GlbItem(0, "RAP8_MUS", base_mus),
        ])
        base_bytes = archive.build()
        hashes = {item.name: "sha256:" + hashlib.sha256(item.data).hexdigest()
                  for item in archive.items}
        sprite = {"link": 1, "slib": 0, "x": 3, "y": 130, "game": 0, "level": 4}
        mod = {
            "format": "rapmod", "version": 1, "requires": hashes,
            "maps": {"MAP1G1_MAP": {
                "tiles": [{"r": 4, "c": 2, "value": {"flats": 1, "fgame": 0}}],
                "spriteGroups": [{"at": 0, "delete": 0, "insert": [[sprite]]}],
            }},
            "libs": {"1": {"fields": [{"index": 0, "set": {"hits": 40}}]}},
            "flats": {"1": {"fields": [{"index": 1, "set": {"bonus": 30}}]}},
            "music": {"RAP8_MUS": {"label": "replacement", "mus": base64.b64encode(changed_mus).decode()}},
        }

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_dir, out_dir = root / "data", root / "patched"
            data_dir.mkdir()
            (data_dir / "FILE0001.GLB").write_bytes(base_bytes)
            mod_path = root / "test.rapmod"
            mod_path.write_text(json.dumps(mod), encoding="utf-8")
            tool = Path(__file__).parent.parent / "tools" / "glbtool.py"
            result = subprocess.run(
                [sys.executable, str(tool), "mod2glb", str(data_dir), str(mod_path), "-o", str(out_dir)],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            actual_bytes = (out_dir / "FILE0001.GLB").read_bytes()
            actual = GlbFile.parse(actual_bytes)
            by_name = {item.name: item.data for item in actual.items}
            patched_map = parse_map(by_name["MAP1G1_MAP"])
            self.assertEqual(patched_map["tiles"][4][2], {"flats": 1, "fgame": 0})
            self.assertEqual(patched_map["sprites"][0]["x"], 3)
            self.assertEqual(parse_sprite_lib(by_name["SPRITE1_ITM"])[0]["hits"], 40)
            self.assertEqual(parse_flats(by_name["FLATSG1_ITM"])[1]["bonus"], 30)
            self.assertEqual(by_name["RAP8_MUS"], changed_mus)

            direct = GlbSet(data_dir)
            self.assertEqual(apply_rapmod(direct, copy.deepcopy(mod)), {1})
            self.assertEqual(direct.files[1].build(), actual_bytes)

            for label, break_mod in (
                ("hash", lambda value: value["requires"].__setitem__("MAP1G1_MAP", "sha256:" + "0" * 64)),
                ("sprite", lambda value: value["maps"]["MAP1G1_MAP"]["spriteGroups"][0]["insert"][0][0].__setitem__("slib", 99)),
                ("music", lambda value: value["music"]["RAP8_MUS"].__setitem__("mus", base64.b64encode(b"bad").decode())),
            ):
                with self.subTest(rejection=label):
                    bad = copy.deepcopy(mod)
                    break_mod(bad)
                    clean = GlbSet(data_dir)
                    before = clean.files[1].build()
                    with self.assertRaises(ValueError):
                        apply_rapmod(clean, bad)
                    self.assertEqual(clean.files[1].build(), before)


if __name__ == "__main__":
    unittest.main()

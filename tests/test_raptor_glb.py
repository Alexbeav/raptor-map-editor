import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))

from raptor_glb import (  # noqa: E402
    GlbFile, GlbItem, build_flats, build_map, decrypt, encrypt, parse_flats,
    parse_map,
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


if __name__ == "__main__":
    unittest.main()

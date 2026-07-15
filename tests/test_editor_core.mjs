// Fixture-independent CORE tests plus optional real-data integration checks:
// node tests/test_editor_core.mjs ["..\\glb files"]
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// point at a folder containing your own FILE000n.GLB files (never committed)
const dataDir = process.argv[2] ?? join(here, "..", "glbs");

const html = readFileSync(join(here, "..", "index.html"), "utf8");
const core = html.match(/\/\* =+ CORE ==[\s\S]*?\*\/([\s\S]*?)\/\* =+ END CORE/);
if (!core) throw new Error("CORE block not found in index.html");
const exports_ = {};
new Function("exports", core[1] +
  "\nObject.assign(exports, {glbDecrypt, glbEncrypt, parseGlb, buildGlb, parseMap, buildMap, validateMap, parseSpriteLib, buildSpriteLib, parseFlats, buildFlats, decodePic, spawnGroups, normalizeSpawnOrder, deleteSpritePreservingGroups, collectMapWarnings, diffMapPatch, applyMapPatch, diffRecordBank, applyRecordBankPatch, validateMus});"
)(exports_);
const { parseGlb, buildGlb, parseMap, buildMap, parseSpriteLib, buildSpriteLib, parseFlats, buildFlats,
  decodePic, spawnGroups, normalizeSpawnOrder, deleteSpritePreservingGroups, collectMapWarnings,
  diffMapPatch, applyMapPatch, diffRecordBank, applyRecordBankPatch, validateMus } = exports_;

let failures = 0;
const check = (label, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Always-runnable synthetic checks.
const plain = Uint8Array.from({ length: 257 }, (_, i) => (i * 73) & 255);
check("cipher encrypt/decrypt", eq(exports_.glbDecrypt(exports_.glbEncrypt(plain)), plain));
const syntheticGlb = { items: [
  { flags: 0, name: "PLAIN", data: new Uint8Array([1, 2, 3]) },
  { flags: 1, name: "SECRET", data: plain },
] };
const syntheticBytes = buildGlb(syntheticGlb);
check("synthetic GLB round trip", eq(buildGlb(parseGlb(syntheticBytes.buffer)), syntheticBytes));

const emptyTiles = Array.from({ length: 150 }, () =>
  Array.from({ length: 9 }, () => ({ flats: 0, fgame: 0 })));
const syntheticMap = { tiles: emptyTiles, sprites: [
  { link: 0, slib: 0, x: 0, y: 100, game: 0, level: 4 },
  { link: 1, slib: 0, x: 1, y: 100, game: 0, level: 4 },
  { link: 1, slib: 0, x: 2, y: 90, game: 0, level: 4 },
] };
check("synthetic map round trip", eq(buildMap(parseMap(buildMap(syntheticMap))), buildMap(syntheticMap)));
deleteSpritePreservingGroups(syntheticMap.sprites, 1);
check("deleting a group terminator repairs the preceding link", syntheticMap.sprites[0].link === 1);
for (const [label, tiles] of [["149 rows", emptyTiles.slice(0, 149)], ["151 rows", [...emptyTiles, emptyTiles[0]]]]) {
  let rejected = false;
  try { buildMap({ tiles, sprites: [] }); } catch { rejected = true; }
  check(`invalid map rejected: ${label}`, rejected);
}
const mus = new Uint8Array(17);
mus.set([0x4D, 0x55, 0x53, 0x1A]);
new DataView(mus.buffer).setUint16(4, 1, true);
new DataView(mus.buffer).setUint16(6, 16, true);
mus[16] = 0x60;
check("DMX MUS header validation", validateMus(mus).scoreLen === 1);
const syntheticFlats = [
  { linkflat: 0, bonus: 0, bounty: 0 },
  { linkflat: 0, bonus: 25, bounty: 150 },
];
check("synthetic FLATS round trip", JSON.stringify(parseFlats(buildFlats(syntheticFlats))) === JSON.stringify(syntheticFlats));
let badFlatsRejected = false;
try { buildFlats([{ ...syntheticFlats[0], bounty: 32768 }]); } catch { badFlatsRejected = true; }
check("invalid FLATS rejected", badFlatsRejected);

const warningMap = { tiles: emptyTiles, sprites: [
  { link: 1, slib: 2, x: 0, y: 100, game: 0, level: 0 },
  { link: 1, slib: 0, x: 1, y: 110, game: 0, level: 4 },
] };
const warnings = collectMapWarnings(warningMap, {
  spriteLibs: new Map([[0, [{}]]]), flatsLibs: new Map([[0, [{ linkflat: 0, bonus: 0, bounty: 0 }]]]),
});
check("map warnings identify unused difficulty", warnings.filter(w => w.code === "unused-level").length === 1);
check("map warnings identify spawn cursor stall", warnings.filter(w => w.code === "spawn-order").length === 1);
check("map warnings identify missing sprite entry", warnings.filter(w => w.code === "missing-sprite").length === 1);
check("map warnings omit valid tile references", warnings.every(w => w.code !== "missing-tile"));
check("empty map warning", collectMapWarnings({ tiles: emptyTiles, sprites: [] }).some(w => w.code === "empty-map"));

const patchBase = { tiles: JSON.parse(JSON.stringify(emptyTiles)), sprites: [
  { link: 1, slib: 0, x: 0, y: 100, game: 0, level: 4 },
  { link: 1, slib: 1, x: 1, y: 90, game: 0, level: 4 },
] };
const patchEdited = JSON.parse(JSON.stringify(patchBase));
patchEdited.tiles[4][2].flats = 1;
patchEdited.sprites[0].x = 3;
patchEdited.sprites.push({ link: 1, slib: 2, x: 2, y: 80, game: 0, level: 3 });
const mapPatch = diffMapPatch(patchBase, patchEdited);
check("rapmod map diff stores only changed tile", mapPatch.tiles.length === 1 && mapPatch.tiles[0].r === 4);
check("rapmod map diff/apply round trip", JSON.stringify(applyMapPatch(patchBase, mapPatch)) === JSON.stringify(patchEdited));
const bankBase = [{ hits: 10, name: "A", path: [1, 2] }, { hits: 20, name: "B", path: [] }];
const bankEdited = [{ hits: 15, name: "A", path: [1, 2] }, bankBase[1], { hits: 30, name: "C", path: [] }];
const bankPatch = diffRecordBank(bankBase, bankEdited);
check("rapmod bank diff stores changed fields and append", bankPatch.fields[0].set.hits === 15 && !Object.hasOwn(bankPatch.fields[0].set, "name") && bankPatch.append.length === 1);
check("rapmod bank diff/apply round trip", JSON.stringify(applyRecordBankPatch(bankBase, bankPatch)) === JSON.stringify(bankEdited));
let unknownPatchRejected = false;
try { applyMapPatch(patchBase, { newerField: [] }); } catch { unknownPatchRejected = true; }
check("rapmod unknown map section rejected", unknownPatchRejected);

const required = Array.from({ length: 5 }, (_, n) => join(dataDir, `FILE000${n}.GLB`));
if (!required.every(existsSync)) {
  console.log("\nSKIP  real-data integration checks (pass a directory containing FILE0000.GLB-FILE0004.GLB)");
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nall fixture-independent tests passed");
  process.exit(failures ? 1 : 0);
}

// GLB round trip on every archive
for (let n = 0; n <= 4; n++) {
  const raw = new Uint8Array(readFileSync(join(dataDir, `FILE000${n}.GLB`)));
  const glb = parseGlb(raw.buffer);
  check(`FILE000${n}.GLB parse+build byte-identical (${glb.items.length} items)`,
    eq(buildGlb(glb), raw));
}

const raw1 = new Uint8Array(readFileSync(join(dataDir, "FILE0001.GLB")));
const glb1 = parseGlb(raw1.buffer);
const byName = name => glb1.items.find(it => it.name === name);

// map parse/build
const mapItem = byName("MAP1G1_MAP");
const m = parseMap(mapItem.data);
check("MAP1G1_MAP: 299 sprites", m.sprites.length === 299);
check("MAP1G1_MAP: first cell flats=116", m.tiles[0][0].flats === 116);
check("MAP1G1_MAP: buildMap round trip", eq(buildMap(m), mapItem.data));

// mutating edit survives rebuild
m.sprites.pop();
m.tiles[149][0].flats = 5;
const m2 = parseMap(buildMap(m));
check("edited map: 298 sprites, tile edit kept",
  m2.sprites.length === 298 && m2.tiles[149][0].flats === 5);

// spawn-order invariant (engine spawn cursor, enemy.cpp:691)
const fresh = parseMap(mapItem.data);
check("normalizeSpawnOrder is a no-op on original data",
  JSON.stringify(normalizeSpawnOrder(fresh.sprites)) === JSON.stringify(fresh.sprites));
const withTail = [...fresh.sprites, { link: 1, slib: 11, x: 4, y: 130, game: 0, level: 3 }];
const fixed = normalizeSpawnOrder(withTail);
const heads = spawnGroups(fixed).map(g => g[0].y);
check("appended sprite is sorted into spawn position",
  fixed[fixed.length - 1].y !== 130 && heads.every((y, i) => i === 0 || heads[i - 1] >= y));

// sprite lib + flats
const lib = parseSpriteLib(byName("SPRITE1_ITM").data);
check("SPRITE1_ITM: 131 entries, [0]=TARGT1G1_PIC hp40",
  lib.length === 131 && lib[0].iname === "TARGT1G1_PIC" && lib[0].hits === 40);

// full SPRITE codec: byte-identical round trip on all 4 banks
for (let bank = 0; bank < 4; bank++) {
  const fnum = [1, 2, 3, 4][bank];
  const raw = new Uint8Array(readFileSync(join(dataDir, `FILE000${fnum}.GLB`)));
  const g = parseGlb(raw.buffer);
  const item = g.items.find(it => it.name === `SPRITE${bank + 1}_ITM`);
  const parsed = parseSpriteLib(item.data);
  check(`SPRITE${bank + 1}_ITM full codec round trip (${parsed.length} entries)`,
    eq(buildSpriteLib(parsed), item.data));
}

// duplicate-entry grows the lib by exactly one record
const grown = buildSpriteLib([...lib, JSON.parse(JSON.stringify(lib[13]))]);
check("duplicated entry appends one 528-byte record",
  grown.length === (lib.length + 1) * 528 &&
  parseSpriteLib(grown)[lib.length].iname === lib[13].iname);
const flats = parseFlats(byName("FLATSG1_ITM").data);
check("FLATSG1_ITM: 672 entries", flats.length === 672);
check("FLATSG1_ITM: full codec round trip", eq(buildFlats(flats), byName("FLATSG1_ITM").data));

// graphics decode (palette + GPIC tile + GSPRITE enemy)
const pal = [];
const praw = byName("PALETTE_DAT").data;
for (let i = 0; i < 256; i++) pal.push([praw[i * 3] << 2, praw[i * 3 + 1] << 2, praw[i * 3 + 2] << 2]);
const startIdx = glb1.items.findIndex(it => it.name === "STARTG1TILES");
const tile = decodePic(glb1.items[startIdx + 1].data, pal);
check("tile decode: 32x32 GPIC, opaque", tile && tile.w === 32 && tile.h === 32 && tile.rgba[3] === 255);
const ship = decodePic(byName(lib[13].iname).data, pal);   // SHIP01G1_PIC, GSPRITE
check(`enemy decode: ${lib[13].iname} ${ship?.w}x${ship?.h} GSPRITE`,
  ship && ship.w > 0 && ship.h > 0 && ship.rgba.some((v, i) => i % 4 === 3 && v === 255));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall tests passed");
process.exit(failures ? 1 : 0);

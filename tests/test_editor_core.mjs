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
  "\nObject.assign(exports, {glbDecrypt, glbEncrypt, parseGlb, buildGlb, parseMap, buildMap, validateMap, parseSpriteLib, buildSpriteLib, parseFlats, buildFlats, decodePic, validatePic, quantizeRgba, encodePic, spawnGroups, normalizeSpawnOrder, deleteSpritePreservingGroups, collectMapWarnings, diffMapPatch, applyMapPatch, diffRecordBank, applyRecordBankPatch, validateMus, midiToMus, deltaMakeWave, deltaPatchShipcomp, deltaEndTxtItem});"
)(exports_);
const { parseGlb, buildGlb, parseMap, buildMap, parseSpriteLib, buildSpriteLib, parseFlats, buildFlats,
  decodePic, validatePic, quantizeRgba, encodePic, spawnGroups, normalizeSpawnOrder, deleteSpritePreservingGroups, collectMapWarnings,
  diffMapPatch, applyMapPatch, diffRecordBank, applyRecordBankPatch, validateMus, midiToMus } = exports_;

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
const oddMus = new Uint8Array(20), oddDv = new DataView(oddMus.buffer);
oddMus.set([0x4D, 0x55, 0x53, 0x1A]); oddDv.setUint16(4, 4, true); oddDv.setUint16(6, 16, true);
oddMus.set([0x40, 10, 200, 0x60], 16);
let strictMusRejected = false;
try { validateMus(oddMus, true); } catch { strictMusRejected = true; }
check("legacy MUS import tolerates semantic oddities", validateMus(oddMus).scoreLen === 4 && strictMusRejected);
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

const picGolden = JSON.parse(readFileSync(join(here, "pic_encoder_golden.json"), "utf8"));
const grayPalette = Array.from({ length: 256 }, (_, i) => [i, i, i]);
const quantized = quantizeRgba(picGolden.width, picGolden.height, Uint8Array.from(picGolden.rgba), grayPalette);
const hex = bytes => Buffer.from(bytes).toString("hex");
check("PNG quantizer matches Python golden pixels", eq(quantized.pixels, picGolden.pixels));
check("PNG quantizer matches Python golden mask", eq(quantized.mask, picGolden.mask));
check("GPIC encoder matches Python byte-for-byte", hex(encodePic(picGolden.width, picGolden.height,
  quantized.pixels, quantized.mask, 1)) === picGolden.gpicHex);
check("GSPRITE encoder matches Python byte-for-byte", hex(encodePic(picGolden.width, picGolden.height,
  quantized.pixels, quantized.mask, 0)) === picGolden.gspriteHex);
let oversizePicRejected = false;
try { quantizeRgba(321, 1, new Uint8Array(321 * 4), grayPalette); } catch { oversizePicRejected = true; }
check("oversized imported graphic rejected", oversizePicRejected);
let truncatedPicRejected = false;
try { validatePic(Uint8Array.from(Buffer.from(picGolden.gspriteHex, "hex").subarray(0, -1))); }
catch { truncatedPicRejected = true; }
check("truncated embedded PIC rejected", truncatedPicRejected);

const be16 = value => [(value >> 8) & 255, value & 255];
const be32 = value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const vlq = value => { const out = [value & 127]; while ((value = Math.floor(value / 128))) out.unshift((value & 127) | 128); return out; };
const midiTrack = events => [...Buffer.from("MTrk"), ...be32(events.length), ...events];
const tempoTrack = [0, 0xFF, 0x51, 3, 0x07, 0xA1, 0x20,
  ...vlq(140), 0xFF, 0x51, 3, 0x03, 0xD0, 0x90, 0, 0xFF, 0x2F, 0];
const noteTrack = [0, 0xC0, 5, 0, 0x90, 60, 100, 0, 62, 80,
  ...vlq(280), 0x80, 60, 0, 0, 62, 0, 0, 0xE0, 0, 64,
  0, 0xB0, 7, 100, 0, 0x99, 35, 90, ...vlq(70), 0x89, 35, 0, 0, 0xFF, 0x2F, 0];
const midi = Uint8Array.from([...Buffer.from("MThd"), ...be32(6), ...be16(1), ...be16(2), ...be16(140),
  ...midiTrack(tempoTrack), ...midiTrack(noteTrack)]);
const convertedMus = midiToMus(midi), convertedInfo = validateMus(convertedMus);
check("format-1 MIDI converts to valid MUS", convertedInfo.scoreLen > 0 && convertedInfo.channels === 1);
check("MIDI instrument table includes melodic and percussion patches",
  JSON.stringify(convertedInfo.patches) === JSON.stringify([5, 135]));
check("MIDI tempo map rescales 280 ticks to 52 Raptor MUS ticks",
  convertedMus.subarray(convertedInfo.scoreStart, convertedInfo.scoreStart + convertedInfo.scoreLen).includes(52));
let format2Rejected = false;
try { const bad = midi.slice(); bad[9] = 2; midiToMus(bad); } catch { format2Rejected = true; }
check("MIDI format 2 rejected", format2Rejected);
let smpteRejected = false;
try { const bad = midi.slice(); bad[12] = 0xE7; midiToMus(bad); } catch { smpteRejected = true; }
check("SMPTE MIDI timing rejected", smpteRejected);
const midiGolden = JSON.parse(readFileSync(join(here, "midi_converter_golden.json"), "utf8"));
check("MIDI converter matches midi3mus 1.0.0 at Raptor's 70 Hz rate",
  Buffer.from(midiToMus(Uint8Array.from(Buffer.from(midiGolden.midiHex, "hex")))).toString("hex") === midiGolden.musHex);
const programOnly = Uint8Array.from([...Buffer.from("MThd"), ...be32(6), ...be16(0), ...be16(1), ...be16(96),
  ...midiTrack([0, 0xC0, 5, 0, 0xFF, 0x2F, 0])]);
check("MUS header counts control-only melodic channels", validateMus(midiToMus(programOnly)).channels === 1);

// Delta Sector generator parity: the in-browser generator must produce the
// same patched archives, byte for byte, as tools/install_delta_sector.py.
{
  const { deltaMakeWave, deltaPatchShipcomp, deltaEndTxtItem } = exports_;

  const campaignMap = (wave, game) => {
    const tiles = Array.from({ length: 150 }, (_, r) =>
      Array.from({ length: 9 }, (_, c) => {
        const busyRow = ((r + wave * 3 + game) % 17) < 2;
        if (busyRow && c >= 2 && c <= 6) return { flats: (c + r) % 5 + 1, fgame: game };
        const noisy = ((r * 31 + c * 7 + wave * 13 + game * 5) % 11) === 0;
        return { flats: noisy ? 9 : 0, fgame: game };
      }));
    const sprites = [];
    for (let g = 0; g < 6; g++) {
      const y = 20 + g * 22 + ((wave + game) % 5);
      const n = 1 + (g + wave) % 3;
      for (let i = 0; i < n; i++)
        sprites.push({ link: i === n - 1 ? 1 : 0, slib: (g + i) % 4, x: (g * 2 + i) % 9,
          y: Math.min(139, y + i), game, level: 3 + (g % 3) });
    }
    return buildMap({ rows: 150, cols: 9, tiles, sprites: normalizeSpawnOrder(sprites) });
  };

  const syntheticShipcomp = () => {
    const FLD = 148, fldofs = 148, numflds = 12;
    const labels = ["PILOT", "CALLSIGN", "SAVE", "LOAD", "GAME1", "GAME2",
      "GAME3", "TRAIN", "DIFF", "AUTO", "EXIT", "MISC"];
    const textBytes = Buffer.from(labels.map(l => l + "\0").join(""), "ascii");
    const out = new Uint8Array(fldofs + numflds * FLD + textBytes.length);
    const dv = new DataView(out.buffer);
    dv.setInt32(76, fldofs, true);
    dv.setInt32(80, fldofs + numflds * FLD, true);
    dv.setInt32(96, numflds, true);
    let tOff = 0;
    labels.forEach((l, i) => {
      const base = fldofs + i * FLD;
      out.set(Buffer.from(`FLD${i}`, "ascii"), base + 32);
      dv.setInt32(base + 128, 20 + i * 9, true);
      dv.setInt32(base + 140, tOff, true);
      tOff += l.length + 1;
    });
    out.set(textBytes, fldofs + numflds * FLD);
    return out;
  };

  const fileItems = {
    1: [{ flags: 0, name: "SHIPCOMP_SWD", data: syntheticShipcomp() },
        ...Array.from({ length: 9 }, (_, w) =>
          ({ flags: 0, name: `MAP${w + 1}G1_MAP`, data: campaignMap(w + 1, 0) }))],
    2: Array.from({ length: 9 }, (_, w) =>
        ({ flags: 0, name: `MAP${w + 1}G2_MAP`, data: campaignMap(w + 1, 1) })),
    3: Array.from({ length: 9 }, (_, w) =>
        ({ flags: 0, name: `MAP${w + 1}G3_MAP`, data: campaignMap(w + 1, 2) })),
    4: [{ flags: 0, name: "FILLER_DAT", data: Uint8Array.from([7, 7, 7]) }],
  };

  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const python = ["python3", "python"].find(cmd =>
    spawnSync(cmd, ["--version"], { shell: false }).status === 0);
  if (!python) {
    console.log("SKIP  Delta generator parity (no python on PATH)");
  } else {
    const dir = mkdtempSync(join(tmpdir(), "delta-parity-"));
    try {
      for (const [num, items] of Object.entries(fileItems))
        writeFileSync(join(dir, `FILE000${num}.GLB`), buildGlb({ items }));
      const run = spawnSync(python,
        [join(here, "..", "tools", "install_delta_sector.py"), dir], { encoding: "utf8" });
      check("python Delta installer runs on synthetic archives", run.status === 0);
      if (run.status !== 0) console.error(run.stdout, run.stderr);
      else {
        const byName = name => {
          for (const num of [1, 2, 3, 4]) {
            const hit = fileItems[num].find(it => it.name === name);
            if (hit) return hit.data;
          }
          throw new Error(`missing ${name}`);
        };
        const js4 = buildGlb({ items: [...fileItems[4],
          ...Array.from({ length: 9 }, (_, w) =>
            ({ flags: 0, name: `MAP${w + 1}G4_MAP`, data: deltaMakeWave(byName, w + 1) })),
          deltaEndTxtItem()] });
        const js1 = buildGlb({ items: fileItems[1].map(it => it.name === "SHIPCOMP_SWD"
          ? { ...it, data: deltaPatchShipcomp(it.data) } : it) });
        const py1 = new Uint8Array(readFileSync(join(dir, "FILE0001.GLB")));
        const py4 = new Uint8Array(readFileSync(join(dir, "FILE0004.GLB")));
        check("Delta FILE0004 (9 spliced waves) matches the Python installer byte-for-byte", eq(js4, py4));
        check("Delta FILE0001 (ship-computer patch) matches the Python installer byte-for-byte", eq(js1, py1));
        check("patched ship computer rejects re-patching", deltaPatchShipcomp(
          parseGlb(py1.buffer).items.find(it => it.name === "SHIPCOMP_SWD").data) === null);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

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

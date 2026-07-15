import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function loadCore() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const core = html.match(/\/\* =+ CORE ==[\s\S]*?\*\/([\s\S]*?)\/\* =+ END CORE/);
  if (!core) throw new Error("CORE block not found");
  const exports = {};
  new Function("exports", core[1] +
    "\nObject.assign(exports, {buildGlb, parseGlb, buildMap, parseMap, buildSpriteLib, parseSpriteLib, buildFlats, parseFlats, validateMus});"
  )(exports);
  return exports;
}

function gpic(width, height, color) {
  const out = new Uint8Array(20 + width * height);
  const dv = new DataView(out.buffer);
  dv.setInt32(0, 1, true);
  dv.setInt32(4, 1, true);
  dv.setInt32(12, width, true);
  dv.setInt32(16, height, true);
  out.fill(color, 20);
  return out;
}

function mus(channels) {
  const data = new Uint8Array(17);
  data.set([0x4D, 0x55, 0x53, 0x1A]);
  const dv = new DataView(data.buffer);
  dv.setUint16(4, 1, true); dv.setUint16(6, 16, true); dv.setUint16(8, channels, true);
  data[16] = 0x60;
  return data;
}

function midiFile() {
  const be16 = value => [(value >> 8) & 255, value & 255];
  const be32 = value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  const track = [0, 0xC0, 5, 0, 0x90, 60, 100, 0x81, 0x0C, 0x80, 60, 0, 0, 0xFF, 0x2F, 0];
  return Uint8Array.from([...Buffer.from("MThd"), ...be32(6), ...be16(0), ...be16(1), ...be16(140),
    ...Buffer.from("MTrk"), ...be32(track.length), ...track]);
}

function spriteRecord(hits = 1, frames = 1) {
  const fields = ["item", "bonus", "exptype", "shotspace", "ground", "suck", "frame_rate",
    "num_frames", "countdown", "rewind", "animtype", "shadow", "bossflag", "hits", "money",
    "shootstart", "shootcnt", "shootframe", "movespeed", "numflight", "repos", "flighttype",
    "numguns", "numengs", "sfx", "song"];
  const entry = { iname: "TESTG1_PIC" };
  for (const field of fields) entry[field] = 0;
  entry.num_frames = frames;
  entry.hits = hits;
  for (const field of ["shoot_type", "engx", "engy", "englx", "shootx", "shooty"])
    entry[field] = Array(24).fill(0);
  entry.flightx = Array(30).fill(0);
  entry.flighty = Array(30).fill(0);
  return entry;
}

function fixture() {
  const core = loadCore();
  const tiles = Array.from({ length: 150 }, () =>
    Array.from({ length: 9 }, () => ({ flats: 0, fgame: 0 })));
  const map = { tiles, sprites: [
    { link: 1, slib: 0, x: 1, y: 100, game: 0, level: 0 },
  ] };
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i++) palette.fill(i & 63, i * 3, i * 3 + 3);
  const bytes = core.buildGlb({ items: [
    { flags: 0, name: "PALETTE_DAT", data: palette },
    { flags: 0, name: "STARTG1TILES", data: new Uint8Array() },
    { flags: 0, name: "TILE0G1_PIC", data: gpic(32, 32, 2) },
    { flags: 0, name: "TILE1G1_PIC", data: gpic(32, 32, 12) },
    { flags: 0, name: "ENDG1TILES", data: new Uint8Array() },
    { flags: 0, name: "SPRITE1_ITM", data: core.buildSpriteLib([spriteRecord(1, 2), spriteRecord(5)]) },
    { flags: 0, name: "FLATSG1_ITM", data: core.buildFlats([
      { linkflat: 0, bonus: 0, bounty: 0 },
      { linkflat: 0, bonus: 10, bounty: 25 },
    ]) },
    { flags: 0, name: "TESTG1_PIC", data: gpic(32, 32, 20) },
    { flags: 0, name: "TEST2G1_PIC", data: gpic(32, 32, 21) },
    { flags: 0, name: "RAP8_MUS", data: mus(0) },
    { flags: 0, name: "RAP2_MUS", data: mus(1) },
    { flags: 0, name: "MAP1G1_MAP", data: core.buildMap(map) },
    { flags: 0, name: "", data: gpic(2, 2, 31) },
    { flags: 0, name: "", data: gpic(2, 2, 32) },
    { flags: 0, name: "DUP_PIC", data: gpic(2, 2, 33) },
    { flags: 0, name: "DUP_PIC", data: gpic(2, 2, 34) },
  ] });
  return { core, bytes };
}

async function dropFixture(page, bytes) {
  await page.evaluate(data => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(data)], "FILE0001.GLB",
      { type: "application/octet-stream" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, Array.from(bytes));
  await expect(page.locator("#drop")).toBeHidden();
}

async function clickMapCell(page, col, row) {
  await page.locator("#map").evaluate((canvas, cell) => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    const event = new MouseEvent("mousedown", {
      bubbles: true, button: 0,
      clientX: rect.left + (cell.col * 32 + 16) * sx,
      clientY: rect.top + (cell.row * 32 + 16) * sy,
    });
    canvas.dispatchEvent(event);
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  }, { col, row });
}

async function dragMap(page, from, to, shiftKey = false) {
  await page.locator("#map").evaluate((canvas, gesture) => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    const point = cell => ({
      clientX: rect.left + (cell.col * 32 + 16) * sx,
      clientY: rect.top + (cell.row * 32 + 16) * sy,
    });
    canvas.dispatchEvent(new MouseEvent("mousedown", {
      ...point(gesture.from), bubbles: true, button: 0, shiftKey: gesture.shiftKey,
    }));
    canvas.dispatchEvent(new MouseEvent("mousemove", {
      ...point(gesture.to), bubbles: true, button: 0, shiftKey: gesture.shiftKey,
    }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  }, { from, to, shiftKey });
}

async function moveMapPointer(page, col, row) {
  await page.locator("#map").evaluate((canvas, cell) => {
    const rect = canvas.getBoundingClientRect(), sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    canvas.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientX: rect.left + (cell.col * 32 + 16) * sx,
      clientY: rect.top + (cell.row * 32 + 16) * sy,
    }));
  }, { col, row });
}

async function setPngFiles(page, specs) {
  await page.locator("#artInput").evaluate(async (input, images) => {
    const transfer = new DataTransfer();
    for (const image of images) {
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, image.width, image.height);
      context.fillStyle = image.color; context.fillRect(0, 0, image.width, image.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      transfer.items.add(new File([blob], image.name, { type: "image/png" }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, specs);
}

async function mockDirectory(page, entries, options = {}) {
  await page.addInitScript(config => {
    class MemoryFileHandle {
      constructor(name, data, failWrite) {
        this.kind = "file"; this.name = name; this.bytes = Uint8Array.from(data); this.failWrite = failWrite;
      }
      async getFile() { return new File([this.bytes], this.name); }
      async createWritable() {
        let pending = this.bytes;
        return {
          write: async data => {
            if (this.failWrite) throw new Error("simulated disk write failure");
            if (data instanceof Blob) data = await data.arrayBuffer();
            pending = new Uint8Array(data instanceof ArrayBuffer ? data :
              data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          },
          close: async () => { this.bytes = pending; },
          abort: async () => {},
        };
      }
    }
    class MemoryDirectoryHandle {
      constructor() {
        this.kind = "directory";
        this.files = new Map(config.entries.map(([name, data]) =>
          [name, new MemoryFileHandle(name, data, config.options.failWrite === name)]));
      }
      async *entries() { for (const entry of this.files) yield entry; }
      async queryPermission() { return config.options.permission || "granted"; }
      async requestPermission() { return config.options.permission || "granted"; }
      async getFileHandle(name, createOptions = {}) {
        if (this.files.has(name)) return this.files.get(name);
        if (!createOptions.create) throw new DOMException("not found", "NotFoundError");
        const handle = new MemoryFileHandle(name, [], false); this.files.set(name, handle); return handle;
      }
    }
    const directory = new MemoryDirectoryHandle();
    window.__testDirectory = directory;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => directory });
  }, { entries: Object.entries(entries).map(([name, data]) => [name, Array.from(data)]), options });
}

test("load, warn, edit, undo/redo, and save a synthetic GLB", async ({ page }) => {
  const { core, bytes } = fixture();
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(page, bytes);

  await expect(page.locator("#warningSummary")).toContainText("1 map warning");
  await page.locator("#warningSummary").click();
  await page.locator("#warningList button").click();
  await expect(page.locator("#tabSprites")).toHaveClass(/active/);
  await expect(page.locator("#props")).toBeVisible();
  await page.locator("#groupSpriteChk").check();
  await expect(page.locator("#spriteList .groupHead")).toContainText("TESTG1_PIC · 2 variants");
  await expect(page.locator("#spriteList div[data-i]")).toHaveCount(2);

  await page.locator("#tabTiles").click();
  await page.locator("#tileGridCanvas").click({ position: { x: 51, y: 17 } });
  await expect(page.locator("#flatsForm")).toBeVisible();
  await page.locator("#flatBonus").fill("30");
  await page.locator("#flatBonus").press("Tab");
  await clickMapCell(page, 2, 138);
  await expect(page.locator("#undoBtn")).toBeEnabled();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await expect(page.locator("#redoBtn")).toBeEnabled();
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  await page.keyboard.press("Control+z");
  await clickMapCell(page, 2, 138);
  await expect(page.locator("#redoBtn")).toBeDisabled();

  await page.locator("#tabSprites").click();
  await page.locator("#spriteList div[data-i='0']").click();
  await page.locator("#placeBtn").click();
  await clickMapCell(page, 3, 130);
  await page.keyboard.press("Escape");
  await dragMap(page, { col: 0, row: 95 }, { col: 4, row: 135 }, true);
  await expect(page.locator("#selectionInfo")).toContainText("2 sprites selected");
  await dragMap(page, { col: 1, row: 100 }, { col: 2, row: 100 });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await moveMapPointer(page, 4, 135);
  await page.locator("#propLevel").selectOption("3");
  await page.locator("#copyBtn").click();
  await page.locator("#pasteBtn").click();
  await expect(page.locator("#selectionInfo")).toContainText("2 sprites selected");
  await page.locator("#delBtn").click();
  await page.locator("#undoBtn").click();

  await page.locator("#tabLib").click();
  await page.locator("#groupLibChk").check();
  await expect(page.locator("#libList .groupHead")).toContainText("TESTG1_PIC · 2 variants");
  await page.locator("#libList div[data-i='0']").click();
  const hits = page.locator("#libNums input[data-f='hits']");
  await hits.fill("40");
  await hits.press("Tab");
  await page.locator("#undoBtn").click();
  await expect(hits).toHaveValue("1");
  await page.locator("#redoBtn").click();
  await expect(hits).toHaveValue("40");
  await page.locator("#tabMusic").click();
  await page.locator("#musicSelect").selectOption("RAP2_MUS");

  await page.waitForTimeout(500);
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator("#restoreSessionBtn")).toBeVisible();
  await page.locator("#restoreSessionBtn").click();
  await expect(page.locator("#drop")).toBeHidden();
  await expect(page.locator("#saveBtn")).toContainText("edited");
  await page.locator("#tabLib").click();
  await page.locator("#libList div[data-i='0']").click();
  await expect(hits).toHaveValue("40");
  await page.locator("#tabMusic").click();
  await expect(page.locator("#musicSelect")).toHaveValue("RAP2_MUS");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveBtn").click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  const saved = new Uint8Array(await readFile(savedPath));
  const glb = core.parseGlb(saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength));
  const byName = name => glb.items.find(item => item.name === name).data;
  const editedMap = core.parseMap(byName("MAP1G1_MAP"));
  const editedFlats = core.parseFlats(byName("FLATSG1_ITM"));
  const editedLib = core.parseSpriteLib(byName("SPRITE1_ITM"));

  expect(editedMap.tiles[138][2].flats).toBe(1);
  expect(editedMap.sprites).toHaveLength(4);
  expect(editedMap.sprites.filter(s => s.x === 2 && s.level === 3)).toHaveLength(2);
  expect(editedMap.sprites.filter(s => s.x === 4 && s.level === 3)).toHaveLength(2);
  expect(editedMap.sprites.some(s => s.y === 109)).toBeTruthy();
  expect(editedMap.sprites.some(s => s.y === 139)).toBeTruthy();
  expect(editedMap.sprites.every(s => s.link === 1)).toBeTruthy();
  expect(editedFlats[1].bonus).toBe(30);
  expect(editedLib[0].hits).toBe(40);
  expect(new DataView(byName("RAP8_MUS").buffer, byName("RAP8_MUS").byteOffset).getUint16(8, true)).toBe(1);
});

test("starting fresh removes the saved recovery session", async ({ page }) => {
  const { bytes } = fixture();
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(page, bytes);
  await page.locator("#tabTiles").click();
  await page.locator("#tileGridCanvas").click({ position: { x: 51, y: 17 } });
  await clickMapCell(page, 2, 138);
  await page.waitForTimeout(500);
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator("#freshSessionBtn")).toBeVisible();
  await page.locator("#freshSessionBtn").click();
  await expect(page.locator("#recovery")).toBeHidden();
  await page.reload();
  await expect(page.locator("#recovery")).toBeHidden();
});

test("folder save writes patched archives and preserves the first backup", async ({ page }) => {
  const { core, bytes } = fixture();
  await mockDirectory(page, { "FILE0001.GLB": bytes });

  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await expect(page.locator("#openDropFolderBtn")).toBeVisible();
  await page.locator("#openDropFolderBtn").click();
  await expect(page.locator("#drop")).toBeHidden();
  await page.locator("#tileGridCanvas").click({ position: { x: 51, y: 17 } });
  await clickMapCell(page, 2, 138);
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#saveBtn").click();
  await expect(page.locator("#status")).toContainText("direct save cancelled");
  expect(await page.evaluate(() =>
    Array.from(window.__testDirectory.files.get("FILE0001.GLB").bytes))).toEqual(Array.from(bytes));
  expect(await page.evaluate(() =>
    window.__testDirectory.files.has("FILE0001.GLB.bak"))).toBeFalsy();
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#saveBtn").click();
  await expect(page.locator("#status")).toContainText("saved FILE0001.GLB directly");

  const output = await page.evaluate(() => ({
    saved: Array.from(window.__testDirectory.files.get("FILE0001.GLB").bytes),
    backup: Array.from(window.__testDirectory.files.get("FILE0001.GLB.bak").bytes),
  }));
  expect(Uint8Array.from(output.backup)).toEqual(bytes);
  const saved = Uint8Array.from(output.saved);
  const glb = core.parseGlb(saved.buffer);
  const map = core.parseMap(glb.items.find(item => item.name === "MAP1G1_MAP").data);
  expect(map.tiles[138][2].flats).toBe(1);

  await page.locator("#tileGridCanvas").click({ position: { x: 17, y: 17 } });
  await clickMapCell(page, 2, 138);
  await page.locator("#saveBtn").click();
  await expect.poll(() => page.evaluate(() =>
    Array.from(window.__testDirectory.files.get("FILE0001.GLB.bak").bytes))).toEqual(Array.from(bytes));
});

test("folder open reports denied permission without replacing the session", async ({ page }) => {
  const { bytes } = fixture();
  await mockDirectory(page, { "FILE0001.GLB": bytes }, { permission: "denied" });
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await page.locator("#openDropFolderBtn").click();
  await expect(page.locator("#status")).toContainText("folder permission was not granted");
  await expect(page.locator("#drop")).toBeVisible();
});

test("partial folder failure preserves all backups and reports written archives", async ({ page }) => {
  const { core, bytes } = fixture();
  const secondGlb = core.parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  secondGlb.items.find(item => item.name === "MAP1G1_MAP").name = "MAP1G2_MAP";
  const secondBytes = core.buildGlb(secondGlb);
  await mockDirectory(page, {
    "FILE0001.GLB": bytes,
    "FILE0002.GLB": secondBytes,
  }, { failWrite: "FILE0002.GLB" });
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await page.locator("#openDropFolderBtn").click();
  await expect(page.locator("#drop")).toBeHidden();
  await page.locator("#tileGridCanvas").click({ position: { x: 51, y: 17 } });
  await clickMapCell(page, 2, 138);
  await page.locator("#mapSelect").selectOption("MAP1G2_MAP");
  await clickMapCell(page, 3, 137);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#saveBtn").click();
  await expect(page.locator("#status")).toContainText("folder save stopped");
  await expect(page.locator("#status")).toContainText("FILE0001.GLB was already written");
  const state = await page.evaluate(() => Object.fromEntries(
    [...window.__testDirectory.files].map(([name, handle]) => [name, Array.from(handle.bytes)])));
  expect(state["FILE0001.GLB.bak"]).toEqual(Array.from(bytes));
  expect(state["FILE0002.GLB.bak"]).toEqual(Array.from(secondBytes));
  expect(state["FILE0002.GLB"]).toEqual(Array.from(secondBytes));
  expect(state["FILE0001.GLB"]).not.toEqual(Array.from(bytes));
});

test("rapmod export imports transactionally into a clean session and rolls back", async ({ browser }) => {
  const { core, bytes } = fixture();
  const authorContext = await browser.newContext({ acceptDownloads: true });
  const author = await authorContext.newPage();
  await author.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(author, bytes);
  await author.locator("#tileGridCanvas").click({ position: { x: 51, y: 17 } });
  await author.locator("#flatBonus").fill("30");
  await author.locator("#flatBonus").press("Tab");
  await clickMapCell(author, 2, 138);
  await author.locator("#tabSprites").click();
  await author.locator("#spriteList div[data-i='0']").click();
  await author.locator("#placeBtn").click();
  await clickMapCell(author, 3, 130);
  await author.keyboard.press("Escape");
  await author.locator("#tabLib").click();
  await author.locator("#libList div[data-i='0']").click();
  const hits = author.locator("#libNums input[data-f='hits']");
  await hits.fill("40"); await hits.press("Tab");
  await author.locator("#tabMusic").click();
  await author.locator("#musicSelect").selectOption("RAP2_MUS");
  const modDownloadPromise = author.waitForEvent("download");
  await author.locator("#modExportBtn").click();
  const modDownload = await modDownloadPromise;
  let modBytes = await readFile(await modDownload.path());
  const mod = JSON.parse(modBytes.toString("utf8"));
  expect(mod.format).toBe("rapmod"); expect(mod.version).toBe(1);
  expect(mod.pics).toBeUndefined();
  expect(mod.maps.MAP1G1_MAP.tiles).toHaveLength(1);
  expect(mod.maps.MAP1G1_MAP.spriteGroups.length).toBeGreaterThan(0);
  expect(Object.keys(mod.libs["1"].fields[0].set)).toEqual(["hits"]);
  expect(mod.flats["1"].fields[0].set.bonus).toBe(30);
  expect(mod.music.RAP8_MUS.mus).toBeTruthy();
  expect(Object.keys(mod.requires)).toEqual(expect.arrayContaining([
    "MAP1G1_MAP", "SPRITE1_ITM", "FLATSG1_ITM", "RAP8_MUS",
  ]));
  const original = core.parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const originalPicIndex = original.items.findIndex(entry => entry.name === "TESTG1_PIC");
  const originalPic = original.items[originalPicIndex].data;
  mod.requires[`FILE0001.GLB#${originalPicIndex}`] = `sha256:${createHash("sha256").update(originalPic).digest("hex")}`;
  const unnamedPicIndex = original.items.findIndex(entry => entry.name === "");
  const unnamedPic = original.items[unnamedPicIndex].data;
  mod.requires[`FILE0001.GLB#${unnamedPicIndex}`] = `sha256:${createHash("sha256").update(unnamedPic).digest("hex")}`;
  mod.pics = [
    { op: "replace", file: 1, index: originalPicIndex, name: "TESTG1_PIC",
      pic: Buffer.from(gpic(5, 4, 33)).toString("base64") },
    { op: "append", file: 1, name: "MODNEW_PIC", pic: Buffer.from(gpic(3, 2, 44)).toString("base64") },
    { op: "replace", file: 1, index: unnamedPicIndex, name: "",
      pic: Buffer.from(gpic(2, 2, 55)).toString("base64") },
  ];
  mod.version = 2;
  modBytes = Buffer.from(JSON.stringify(mod));
  await authorContext.close();

  const playerContext = await browser.newContext({ acceptDownloads: true });
  const player = await playerContext.newPage();
  await player.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(player, bytes);
  player.once("dialog", dialog => dialog.accept());
  await player.locator("#modInput").setInputFiles({
    name: "test.rapmod", mimeType: "application/json", buffer: modBytes,
  });
  await expect(player.locator("#status")).toContainText("imported test.rapmod");
  await expect(player.locator("#modUndoBtn")).toBeEnabled();
  const appliedDownloadPromise = player.waitForEvent("download");
  await player.locator("#saveBtn").click();
  const appliedBytes = new Uint8Array(await readFile(await (await appliedDownloadPromise).path()));
  const applied = core.parseGlb(appliedBytes.buffer.slice(appliedBytes.byteOffset,
    appliedBytes.byteOffset + appliedBytes.byteLength));
  const item = name => applied.items.find(entry => entry.name === name).data;
  const map = core.parseMap(item("MAP1G1_MAP"));
  expect(map.tiles[138][2].flats).toBe(1); expect(map.sprites).toHaveLength(2);
  expect(core.parseFlats(item("FLATSG1_ITM"))[1].bonus).toBe(30);
  expect(core.parseSpriteLib(item("SPRITE1_ITM"))[0].hits).toBe(40);
  expect(new DataView(item("RAP8_MUS").buffer, item("RAP8_MUS").byteOffset).getUint16(8, true)).toBe(1);
  expect(new DataView(item("TESTG1_PIC").buffer, item("TESTG1_PIC").byteOffset).getInt32(12, true)).toBe(5);
  expect(item("MODNEW_PIC")).toBeTruthy();
  expect(applied.items[unnamedPicIndex].data[20]).toBe(55);

  await player.locator("#modUndoBtn").click();
  await expect(player.locator("#status")).toContainText("undid the last mod import");
  const rollbackDownloadPromise = player.waitForEvent("download");
  await player.locator("#saveBtn").click();
  const rollbackBytes = new Uint8Array(await readFile(await (await rollbackDownloadPromise).path()));
  expect(rollbackBytes).toEqual(bytes);

  const rejectMod = async (mutate, message) => {
    const invalid = structuredClone(mod);
    mutate(invalid);
    await player.locator("#modInput").setInputFiles({
      name: "invalid.rapmod", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)),
    });
    await expect(player.locator("#status")).toContainText(message);
    await expect(player.locator("#modUndoBtn")).toBeDisabled();
  };
  await rejectMod(value => { value.requires.MAP1G1_MAP = `sha256:${"0".repeat(64)}`; },
    "MAP1G1_MAP base hash does not match");
  await rejectMod(value => { value.maps.MAP1G1_MAP.spriteGroups[0].insert[0][0].slib = 999; },
    "references missing G1:999");
  await rejectMod(value => { value.music.RAP8_MUS.mus = Buffer.from("bad").toString("base64"); },
    "not a DMX MUS file");
  await rejectMod(value => { value.future = {}; }, "made with a newer editor");
  await rejectMod(value => { value.pics[0].pic = Buffer.from("bad").toString("base64"); },
    "PIC item is shorter than its header");
  await rejectMod(value => {
    value.pics[0].index = original.items.findIndex(entry => entry.name === "MAP1G1_MAP");
    value.pics[0].name = "MAP1G1_MAP";
    value.requires[`FILE0001.GLB#${value.pics[0].index}`] = value.requires.MAP1G1_MAP;
  }, "unknown GFX_TYPE");

  const legacy = structuredClone(mod); legacy.version = 1; delete legacy.pics;
  player.once("dialog", dialog => dialog.accept());
  await player.locator("#modInput").setInputFiles({
    name: "legacy.rapmod", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(player.locator("#status")).toContainText("imported legacy.rapmod");
  await player.locator("#modUndoBtn").click();
  await expect(player.locator("#status")).toContainText("undid the last mod import");

  const rejectedDownloadPromise = player.waitForEvent("download");
  await player.locator("#saveBtn").click();
  const rejectedBytes = new Uint8Array(await readFile(await (await rejectedDownloadPromise).path()));
  expect(rejectedBytes).toEqual(bytes);
  await playerContext.close();
});

test("PNG import replaces tile/sprite art and appends consecutive frames", async ({ page }) => {
  const { core, bytes } = fixture();
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(page, bytes);

  await page.locator("#tileGridCanvas").click({ position: { x: 17, y: 17 } });
  await page.locator("#tabLib").click();
  await page.locator("#libList div[data-i='0']").click();

  await page.locator("#artAction").selectOption("replace-tile");
  await setPngFiles(page, [{ name: "tile.png", width: 32, height: 32, color: "rgb(40,80,120)" }]);
  await expect(page.locator("#artApplyBtn")).toBeEnabled();
  await page.locator("#artApplyBtn").click();
  await expect(page.locator("#status")).toContainText("replaced tile graphic TILE0G1_PIC");

  await page.locator("#artAction").selectOption("replace-sprite");
  await setPngFiles(page, [
    { name: "sprite1.png", width: 6, height: 5, color: "rgba(200,80,20,0.8)" },
    { name: "sprite2.png", width: 6, height: 5, color: "rgba(20,80,200,0.8)" },
  ]);
  await page.locator("#artApplyBtn").click();
  await expect(page.locator("#status")).toContainText("replaced 2 sprite frame(s) starting at TESTG1_PIC");

  await page.locator("#artAction").selectOption("append-sprite");
  await page.locator("#artName").fill("AAAAAAAAAAAAA1");
  await setPngFiles(page, Array.from({ length: 12 }, (_, i) =>
    ({ name: `collision${i}.png`, width: 1, height: 1, color: "rgb(20,180,80)" })));
  await page.locator("#artApplyBtn").click();
  await expect(page.locator("#status")).toContainText("choose a shorter name");
  await page.locator("#artName").fill("NEW_PIC");
  await setPngFiles(page, [
    { name: "frame1.png", width: 8, height: 6, color: "rgb(20,180,80)" },
    { name: "frame2.png", width: 8, height: 6, color: "rgb(180,20,80)" },
  ]);
  await page.locator("#artApplyBtn").click();
  await expect(page.locator("#status")).toContainText("appended 2 consecutive sprite frame(s)");

  await page.locator("#undoBtn").click();
  await expect(page.locator("#libIname")).toHaveValue("TESTG1_PIC");
  await page.locator("#redoBtn").click();
  await expect(page.locator("#libIname")).toHaveValue("NEW_PIC");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveBtn").click();
  const output = new Uint8Array(await readFile(await (await downloadPromise).path()));
  const glb = core.parseGlb(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
  const item = name => glb.items.find(entry => entry.name === name);
  expect(new DataView(item("TILE0G1_PIC").data.buffer, item("TILE0G1_PIC").data.byteOffset).getInt32(0, true)).toBe(1);
  expect(new DataView(item("TESTG1_PIC").data.buffer, item("TESTG1_PIC").data.byteOffset).getInt32(12, true)).toBe(6);
  expect(new DataView(item("TEST2G1_PIC").data.buffer, item("TEST2G1_PIC").data.byteOffset).getInt32(12, true)).toBe(6);
  expect(glb.items.slice(-2).map(entry => entry.name)).toEqual(["NEW_PIC", "NEW2_PIC"]);
  const lib = core.parseSpriteLib(item("SPRITE1_ITM").data);
  expect(lib[0].iname).toBe("NEW_PIC"); expect(lib[0].num_frames).toBe(2);

  const modDownloadPromise = page.waitForEvent("download");
  await page.locator("#modExportBtn").click();
  const mod = JSON.parse((await readFile(await (await modDownloadPromise).path())).toString("utf8"));
  expect(mod.version).toBe(2);
  expect(mod.pics.find(picture => picture.name === "TILE0G1_PIC")).toMatchObject({ op: "replace", file: 1 });
  expect(mod.pics.find(picture => picture.name === "TESTG1_PIC")).toMatchObject({ op: "replace", file: 1 });
  expect(mod.pics.find(picture => picture.name === "NEW_PIC")).toMatchObject({ op: "append", file: 1 });
  expect(mod.pics.find(picture => picture.name === "NEW2_PIC")).toMatchObject({ op: "append", file: 1 });
});

test("gun mounts and engine flares edit visually and round-trip", async ({ page }) => {
  const { core, bytes } = fixture();
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(page, bytes);
  await page.locator("#tabLib").click();
  await page.locator("#libList div[data-i='0']").click();

  await page.locator("#pathLayer").selectOption("guns");
  await page.locator("#pathCanvas").click({ position: { x: 100, y: 90 } });
  await expect(page.locator("#pathInfo")).toContainText("1 gun mounts");
  await page.locator("#mountValue").fill("7"); await page.locator("#mountValue").press("Tab");

  await page.locator("#pathLayer").selectOption("engines");
  await page.locator("#pathCanvas").click({ position: { x: 130, y: 120 } });
  await expect(page.locator("#pathInfo")).toContainText("1 engine flares");
  await page.locator("#mountValue").fill("6"); await page.locator("#mountValue").press("Tab");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveBtn").click();
  const output = new Uint8Array(await readFile(await (await downloadPromise).path()));
  const glb = core.parseGlb(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
  const lib = core.parseSpriteLib(glb.items.find(entry => entry.name === "SPRITE1_ITM").data);
  expect(lib[0].numguns).toBe(1); expect(lib[0].shoot_type[0]).toBe(7);
  expect(lib[0].numengs).toBe(1); expect(lib[0].englx[0]).toBe(6);
  expect(lib[0].shootx[0]).not.toBe(lib[0].engx[0]);
});

test("MIDI imports convert locally to a valid shared-slot MUS", async ({ page }) => {
  const { core, bytes } = fixture();
  await page.goto(pathToFileURL(join(root, "index.html")).href);
  await dropFixture(page, bytes);
  await page.locator("#tabMusic").click();
  await page.locator("#musicInput").setInputFiles({
    name: "custom.mid", mimeType: "audio/midi", buffer: Buffer.from(midiFile()),
  });
  await expect(page.locator("#status")).toContainText("converted custom.mid");
  await expect(page.locator("#musicSelect")).toContainText("MIDI→MUS");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveBtn").click();
  const output = new Uint8Array(await readFile(await (await downloadPromise).path()));
  const glb = core.parseGlb(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
  const converted = glb.items.find(entry => entry.name === "RAP8_MUS").data;
  const info = core.validateMus(converted);
  expect(info.channels).toBe(1); expect(info.patches).toEqual([5]);
});

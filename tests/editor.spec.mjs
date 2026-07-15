import { test, expect } from "@playwright/test";
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
    "\nObject.assign(exports, {buildGlb, parseGlb, buildMap, parseMap, buildSpriteLib, parseSpriteLib, buildFlats, parseFlats});"
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

function spriteRecord(hits = 1) {
  const fields = ["item", "bonus", "exptype", "shotspace", "ground", "suck", "frame_rate",
    "num_frames", "countdown", "rewind", "animtype", "shadow", "bossflag", "hits", "money",
    "shootstart", "shootcnt", "shootframe", "movespeed", "numflight", "repos", "flighttype",
    "numguns", "numengs", "sfx", "song"];
  const entry = { iname: "TESTG1_PIC" };
  for (const field of fields) entry[field] = 0;
  entry.num_frames = 1;
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
    { flags: 0, name: "SPRITE1_ITM", data: core.buildSpriteLib([spriteRecord(), spriteRecord(5)]) },
    { flags: 0, name: "FLATSG1_ITM", data: core.buildFlats([
      { linkflat: 0, bonus: 0, bounty: 0 },
      { linkflat: 0, bonus: 10, bounty: 25 },
    ]) },
    { flags: 0, name: "TESTG1_PIC", data: gpic(32, 32, 20) },
    { flags: 0, name: "RAP8_MUS", data: mus(0) },
    { flags: 0, name: "RAP2_MUS", data: mus(1) },
    { flags: 0, name: "MAP1G1_MAP", data: core.buildMap(map) },
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

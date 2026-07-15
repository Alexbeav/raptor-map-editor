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
    { flags: 0, name: "TESTG1_PIC", data: gpic(12, 12, 20) },
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
  expect(editedMap.sprites.some(s => s.x === 3 && s.y === 130 && s.slib === 0)).toBeTruthy();
  expect(editedFlats[1].bonus).toBe(30);
  expect(editedLib[0].hits).toBe(40);
});

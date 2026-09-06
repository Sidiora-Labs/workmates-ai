import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hasSips = (() => {
  try {
    execFileSync("which", ["sips"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

async function resizeWithChromium(source, sizes) {
  const { chromium } = await import("playwright-core");
  const data = `data:image/png;base64,${readFileSync(source).toString("base64")}`;
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const out = [];
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(
        `<style>*{margin:0}html,body{background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${data}">`,
      );
      await page.waitForTimeout(50);
      out.push({ size, bytes: await page.screenshot({ omitBackground: true }) });
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}

const SIZES = [256, 128, 64, 48, 32, 16];
const SOURCE = new URL("../build/icon.png", import.meta.url).pathname;
const OUT = new URL("../build/icon.ico", import.meta.url).pathname;

const work = mkdtempSync(join(tmpdir(), "workmates-ico-"));
const pngs = hasSips
  ? SIZES.map((size) => {
      const out = join(work, `${size}.png`);
      execFileSync("sips", ["-z", String(size), String(size), SOURCE, "--out", out], {
        stdio: "ignore",
      });
      return { size, bytes: readFileSync(out) };
    })
  : await resizeWithChromium(SOURCE, SIZES);

const HEADER = 6;
const ENTRY = 16;
const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

const entries = [];
let offset = HEADER + ENTRY * pngs.length;
for (const { size, bytes } of pngs) {
  const entry = Buffer.alloc(ENTRY);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(bytes.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += bytes.length;
}

writeFileSync(OUT, Buffer.concat([header, ...entries, ...pngs.map((p) => p.bytes)]));
rmSync(work, { recursive: true, force: true });
console.log(`build/icon.ico  ${pngs.length} sizes, ${offset} bytes`);

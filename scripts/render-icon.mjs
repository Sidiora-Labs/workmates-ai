import { chromium } from "playwright-core";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "build", "icon.png");
const DOCK = path.join(root, "electron", "resources", "app-icon.png");

const mark = readFileSync(path.join(root, "public", "brand", "workmates-logo.svg"), "utf8").replace(
  'fill="currentColor"',
  'fill="#ffffff"',
);
const markData = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

const html = `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1024px;height:1024px;background:transparent}
  .tile{position:relative;width:1024px;height:1024px;border-radius:224px;
        background:linear-gradient(160deg,#2a2a2f 0%,#0b0b0d 100%);
        display:flex;align-items:center;justify-content:center;overflow:hidden}
  .tile img{width:66%}
  .ring{position:absolute;inset:0;border-radius:224px;
        box-shadow:inset 0 0 0 16px rgba(255,255,255,.07)}
</style>
<div class="tile"><img src="${markData}"><div class="ring"></div></div>`;

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT, omitBackground: true });
await browser.close();

copyFileSync(OUT, DOCK);
console.log(`wrote ${path.relative(root, OUT)} and ${path.relative(root, DOCK)}`);

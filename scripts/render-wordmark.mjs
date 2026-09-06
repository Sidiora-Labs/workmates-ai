import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = (theme) => path.join(root, "public", "brand", `workmates-wordmark-${theme}.png`);

const mark = (ink) =>
  readFileSync(path.join(root, "public", "brand", "workmates-logo.svg"), "utf8").replace(
    'fill="currentColor"',
    `fill="${ink}"`,
  );
const markData = (ink) => `data:image/svg+xml;base64,${Buffer.from(mark(ink)).toString("base64")}`;

const font = readFileSync(
  path.join(root, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2"),
);
const fontData = `data:font/woff2;base64,${font.toString("base64")}`;

const HEIGHT = 582;
const CAP = 300;
const FONT_SIZE = Math.round(CAP / 0.727);
const INK = { light: "#1d1d1f", dark: "#ffffff" };

const html = (ink) => `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:"Inter Variable";font-weight:100 900;src:url(${fontData}) format("woff2")}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:transparent}
  #wm{display:inline-flex;align-items:center;height:${HEIGHT}px;padding:0 24px;gap:${Math.round(CAP * 0.28)}px;
      font:700 ${FONT_SIZE}px/1 "Inter Variable";letter-spacing:-0.03em;color:${ink}}
  #wm img{height:${Math.round(CAP * 1.5)}px}
</style>
<div id="wm"><img src="${markData(ink)}" alt=""><span>Workmates</span></div>`;

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 4200, height: HEIGHT + 40 }, deviceScaleFactor: 1 });
    await page.setContent(html(INK[theme]));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.locator("#wm").screenshot({ path: OUT(theme), omitBackground: true });
    await page.close();
    console.log(`wrote ${path.relative(root, OUT(theme))}`);
  }
} finally {
  await browser.close();
}

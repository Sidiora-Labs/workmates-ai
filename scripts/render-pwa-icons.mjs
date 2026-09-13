import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(out, { recursive: true });
const svg = readFileSync(new URL("../public/app-icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const [size, name] of [[192, "icon-192"], [512, "icon-512"], [180, "apple-touch-icon"]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1, colorScheme: "dark" });
    await page.setContent(`<style>body{margin:0;background:#18181b}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.close();
  }
} finally { await browser.close(); }

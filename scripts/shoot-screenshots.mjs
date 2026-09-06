#!/usr/bin/env node
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8813;
const URL = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env.CHROMIUM_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = mkdtempSync(join(tmpdir(), "workmates-shots-"));
let server;
try {
  execFileSync("node", [join(repo, "scripts", "seed-demo.mjs"), home], { stdio: "pipe" });
  execFileSync("pnpm", ["build"], { cwd: repo, stdio: "pipe" });

  server = spawn(process.execPath, [join(repo, "server", "index.ts")], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      WORKMATES_PORT: String(PORT),
      WORKMATES_STATIC_DIR: join(repo, "dist"),
    },
    stdio: "ignore",
  });

  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${URL}/api/health`)).ok) break;
    } catch {
    }
    await wait(500);
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const [file, shot, dark] of [
    ["hero.png", "room", false],
    ["hero-dark.png", "room", true],
    ["engines.png", "engines", false],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1360, height: 880 },
      deviceScaleFactor: 2,
      colorScheme: dark ? "dark" : "light",
      timezoneId: "UTC",
    });
    await page.goto(URL, { waitUntil: "networkidle" });
    await wait(2500);

    for (let i = 0; i < 10; i++) {
      const clicked = await page.evaluate(() => {
        const words = ["Skip intro", "Skip this", "Skip for now", "Continue where I left off", "Continue", "Next", "Done", "Get started"];
        const b = [...document.querySelectorAll("button")].find((x) => words.includes((x.textContent || "").trim()));
        if (!b) return false;
        b.click();
        return true;
      });
      if (!clicked) break;
      await wait(800);
    }

    await page.evaluate(async (wantDark) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const byTitle = (t) => [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === t);
      const byText = (t) => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === t);
      byTitle("Settings")?.click(); await sleep(900);
      byText("General")?.click(); await sleep(500);
      byText(wantDark ? "Dark" : "Light")?.click(); await sleep(800);
      [...document.querySelectorAll("button")].reverse()
        .find((x) => (x.getAttribute("aria-label") || "") === "Close" || (x.textContent || "").trim() === "Close")?.click();
      await sleep(700);
    }, dark);

    await page.evaluate(async (which) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const byTitle = (t) => [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "") === t);
      const byText = (t) => [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === t);
      if (which === "engines") {
        byTitle("Settings")?.click(); await sleep(900);
        byText("Engines")?.click(); await sleep(900);
        return;
      }
      [...document.querySelectorAll("button")]
        .find((x) => (x.textContent || "").trim().startsWith("Launch week"))?.click();
      await sleep(1500);
      const scrollers = [...document.querySelectorAll("*")].filter(
        (e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== "visible",
      );
      const t = scrollers[scrollers.length - 1];
      if (t) t.scrollTop = t.scrollHeight;
      await sleep(700);
    }, shot);

    await page.evaluate(() =>
      document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null,
    );
    await wait(1200);

    const out = join(repo, "docs", "screenshots", file);
    await page.screenshot({ path: out });
    await page.close();
    console.log("wrote docs/screenshots/" + file);
  }
  await browser.close();
} finally {
  server?.kill("SIGTERM");
  await wait(500);
  rmSync(home, { recursive: true, force: true });
}

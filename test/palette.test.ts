import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync, statSync } from "node:fs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(repo, "src", "styles.css"), "utf8");

type Rgb = { r: number; g: number; b: number };

const hex = (value: string): Rgb => {
  const h = value.replace("#", "").trim();
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const wash = (over: Rgb, under: Rgb, alpha: number): Rgb => ({
  r: alpha * over.r + (1 - alpha) * under.r,
  g: alpha * over.g + (1 - alpha) * under.g,
  b: alpha * over.b + (1 - alpha) * under.b,
});

function token(name: string, block: "light" | "dark"): string {
  const opener = block === "light" ? ":root {" : ".dark {";
  const start = css.indexOf(opener);
  assert.ok(start >= 0, `no ${block} block in styles.css`);
  const end = css.indexOf("\n}", start);
  assert.ok(end > start, `the ${block} block in styles.css is not closed`);
  const section = css.slice(start, end);
  const matches = [...section.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))];
  assert.ok(matches.length, `--${name} is not defined in the ${block} palette`);
  return matches[matches.length - 1][1].trim();
}

const AA = 4.5;

describe("light mode reads", () => {
  const white = hex("#ffffff");
  const surfaces = {
    background: hex(token("background", "light")),
    card: hex(token("card", "light")),
    muted: hex(token("muted", "light")),
    accent: hex(token("accent", "light")),
    sidebar: hex(token("sidebar", "light")),
  };

  test("body and muted text clear the bar on every surface they sit on", () => {
    for (const name of ["foreground", "muted-foreground"]) {
      const ink = hex(token(name, "light"));
      for (const [where, surface] of Object.entries(surfaces)) {
        const ratio = contrast(ink, surface);
        assert.ok(ratio >= AA, `--${name} on --${where} is ${ratio.toFixed(2)}:1, wanted ${AA}`);
      }
    }
  });

  test("a status colour clears the bar on the wash of itself a badge puts it on", () => {
    for (const name of ["destructive", "success", "warning"]) {
      const ink = hex(token(name, "light"));
      assert.ok(contrast(ink, white) >= AA, `--${name} on white is ${contrast(ink, white).toFixed(2)}:1`);
      for (const alpha of [0.05, 0.1, 0.15]) {
        const ratio = contrast(ink, wash(ink, white, alpha));
        assert.ok(
          ratio >= AA,
          `--${name} on a ${alpha * 100}% wash of itself is ${ratio.toFixed(2)}:1, wanted ${AA}`,
        );
      }
    }
  });

  test("brand ink reads as words, on white and on every brand wash", () => {
    const ink = hex(token("brand-ink", "light"));
    const brand = hex(token("brand", "light"));
    const soft = hex(token("brand-soft", "light"));
    assert.ok(contrast(ink, white) >= AA, `brand ink on white is ${contrast(ink, white).toFixed(2)}:1`);
    assert.ok(contrast(ink, soft) >= AA, `brand ink on brand-soft is ${contrast(ink, soft).toFixed(2)}:1`);
    assert.ok(
      contrast(ink, wash(brand, white, 0.15)) >= AA,
      `brand ink on a 15% brand wash is ${contrast(ink, wash(brand, white, 0.15)).toFixed(2)}:1`,
    );
  });

  test("the focus ring can be seen, which is the whole job of a focus ring", () => {
    const ring = hex(token("ring", "light"));
    for (const [where, surface] of Object.entries(surfaces)) {
      const ratio = contrast(ring, surface);
      assert.ok(ratio >= 3, `the focus ring on --${where} is ${ratio.toFixed(2)}:1, wanted 3`);
    }
  });

  test("anything sitting on a brand fill reads, which is what the ink fill is for", () => {
    const foreground = hex(token("brand-foreground", "light"));
    const ink = hex(token("brand-ink", "light"));
    const ratio = contrast(foreground, ink);
    assert.ok(ratio >= AA, `--brand-foreground on --brand-ink is ${ratio.toFixed(2)}:1, wanted ${AA}`);
  });
});

describe("dark mode reads", () => {
  const surfaces = {
    background: hex(token("background", "dark")),
    card: hex(token("card", "dark")),
    muted: hex(token("muted", "dark")),
    accent: hex(token("accent", "dark")),
    sidebar: hex(token("sidebar", "dark")),
  };

  test("body, muted and every status colour clear the bar", () => {
    for (const name of ["foreground", "muted-foreground", "destructive", "success", "warning", "brand-ink"]) {
      const ink = hex(token(name, "dark"));
      for (const [where, surface] of Object.entries(surfaces)) {
        const ratio = contrast(ink, surface);
        assert.ok(ratio >= AA, `--${name} on --${where} is ${ratio.toFixed(2)}:1 in dark mode, wanted ${AA}`);
      }
    }
  });

  test("the focus ring can be seen in the dark too", () => {
    const ring = hex(token("ring", "dark"));
    for (const [where, surface] of Object.entries(surfaces)) {
      const ratio = contrast(ring, surface);
      assert.ok(ratio >= 3, `the focus ring on --${where} is ${ratio.toFixed(2)}:1 in dark mode, wanted 3`);
    }
  });

  test("anything on a brand fill reads there too", () => {
    const ratio = contrast(hex(token("brand-foreground", "dark")), hex(token("brand-ink", "dark")));
    assert.ok(ratio >= AA, `--brand-foreground on --brand-ink is ${ratio.toFixed(2)}:1 in dark mode`);
  });
});

describe("the rule that keeps it that way", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx") || full.endsWith(".ts")) files.push(full);
    }
  };
  walk(join(repo, "src"));

  test("a brand fill that carries a foreground uses the ink, never the plain brand", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        if (!/\btext-brand-foreground\b/.test(line)) return;
        if (!/\bbg-brand(?![\w\-/])/.test(line)) return;
        offenders.push(`${file.slice(repo.length + 1)}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, [], "these put a foreground on the plain brand fill");
  });

  const ALLOWED_TO_PICK_A_COLOUR: Record<string, string> = {
    "src/components/welcome/Brand.tsx": "the pixel weather behind the welcome screens, fixed colours that do not follow the theme",
    "src/components/welcome/Intro.tsx": "the traffic lights on the drawn window, which are Apple's colours",
    "src/components/agents/ProviderIcons.tsx": "other people's logos, which are theirs and not ours to theme",
    "src/components/settings/DevicesSection.tsx": "a QR code, which needs literal black on literal white to scan",
    "src/components/chat/Terminal.tsx": "a fallback for when the custom property cannot be read from a canvas",
    "src/components/settings/McpApps.tsx": "the same fallback, for a sandboxed frame",
  };

  test("there is one focus ring, and no component brings a weaker one", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        if (/focus-visible:ring/.test(line)) offenders.push(`${file.slice(repo.length + 1)}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, [], "these override the app's focus ring with their own");
  });

  test("only the files with a reason decide a colour of their own", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = file.slice(repo.length + 1);
      if (ALLOWED_TO_PICK_A_COLOUR[relative]) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/#[0-9a-fA-F]{6}\b/.test(line) && /className|style=|background|color:/.test(line)) {
          offenders.push(`${relative}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], "these decide a colour outside the palette, with no reason on the list");
  });

  test("the colours handed to an MCP document still match the palette", () => {
    const frame = readFileSync(join(repo, "server", "integrations", "mcp-apps.ts"), "utf8");
    const defaults = frame.match(/dark \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})"/g) ?? [];
    assert.ok(defaults.length >= 5, "the MCP theme defaults moved and this test cannot find them");
    for (const [name, light, dark] of [
      ["background", token("background", "light"), token("card", "dark")],
      ["foreground", token("foreground", "light"), token("foreground", "dark")],
      ["muted", token("muted-foreground", "light"), token("muted-foreground", "dark")],
      ["accent", token("brand-ink", "light"), token("brand-ink", "dark")],
    ] as const) {
      const pair = defaults.find(
        (d) => d.includes(light.toLowerCase()) && d.includes(dark.toLowerCase()),
      );
      assert.ok(pair, `the MCP frame's ${name} is not the pair ${dark} / ${light}, so the palette moved without it`);
    }
  });

  test("every file on the list still needs to be on it", () => {
    for (const [relative, why] of Object.entries(ALLOWED_TO_PICK_A_COLOUR)) {
      const source = readFileSync(join(repo, relative), "utf8");
      assert.ok(/#[0-9a-fA-F]{6}\b/.test(source), `${relative} no longer picks a colour: ${why}`);
    }
  });
});

import { build } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

await build({
  entryPoints: [require.resolve("electron-updater")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "electron/vendor/electron-updater.cjs",
  external: ["electron"],
  minify: true,
  logLevel: "warning",
});
console.log("[bundle-updater] electron/vendor/electron-updater.cjs written");

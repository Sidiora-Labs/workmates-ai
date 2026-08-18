import type { Readable } from "node:stream";

export function readJsonLines(stream: Readable, each: (value: any) => void) {
  let buffered = "";

  stream.on("data", (chunk) => {
    buffered += chunk;
    for (;;) {
      const cut = buffered.indexOf("\n");
      if (cut === -1) break;

      const line = buffered.slice(0, cut);
      buffered = buffered.slice(cut + 1);
      if (!line.trim()) continue;

      try {
        each(JSON.parse(line));
      } catch {
      }
    }
  });
}

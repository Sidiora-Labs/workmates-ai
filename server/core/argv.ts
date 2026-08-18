export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }

    if (ch === "\\") {
      const next = line[i + 1];
      if (next === undefined) {
        current += "\\";
        started = true;
        continue;
      }
      if (quote === '"' && next !== '"' && next !== "\\") {
        current += ch;
        started = true;
        continue;
      }
      current += next;
      started = true;
      i++;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') quote = null;
      else current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = "";
      started = false;
      continue;
    }

    current += ch;
    started = true;
  }

  if (started) args.push(current);
  return args;
}

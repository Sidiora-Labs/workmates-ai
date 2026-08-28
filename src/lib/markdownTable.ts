export type Align = "left" | "center" | "right";

export interface TableBlock {
  kind: "table";
  columns: string[];
  aligns: Align[];
  rows: string[][];
}

export interface LinesBlock {
  kind: "lines";
  lines: string[];
  offset: number;
}

export type Block = TableBlock | LinesBlock;

export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function alignmentsOf(line: string): Align[] | null {
  if (!line.includes("-")) return null;
  const cells = splitRow(line);
  if (!cells.length) return null;
  const aligns: Align[] = [];
  for (const cell of cells) {
    const m = cell.match(/^(:?)-{1,}(:?)$/);
    if (!m) return null;
    aligns.push(m[1] && m[2] ? "center" : m[2] ? "right" : m[1] ? "left" : "left");
  }
  return aligns;
}

const looksLikeRow = (line: string) => /(^|[^\\])\|/.test(line);

export function splitBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let pending: string[] = [];
  let pendingAt = 0;

  const flush = () => {
    if (pending.length) blocks.push({ kind: "lines", lines: pending, offset: pendingAt });
    pending = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const aligns = i + 1 < lines.length ? alignmentsOf(lines[i + 1]) : null;
    if (!aligns || !looksLikeRow(header)) {
      if (!pending.length) pendingAt = i;
      pending.push(header);
      continue;
    }
    const columns = splitRow(header);
    if (columns.length !== aligns.length) {
      if (!pending.length) pendingAt = i;
      pending.push(header);
      continue;
    }
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || !looksLikeRow(line)) break;
      const cells = splitRow(line);
      while (cells.length < columns.length) cells.push("");
      rows.push(cells.slice(0, columns.length));
    }
    flush();
    blocks.push({ kind: "table", columns, aligns, rows });
    i = j - 1;
    pendingAt = j;
  }
  flush();
  return blocks;
}

export function hasTable(text: string): boolean {
  return splitBlocks(text).some((block) => block.kind === "table");
}

const LANGUAGE_NAMES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  swift: "Swift",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  sql: "SQL",
};

export function speakable(text: string): string {
  let out = text;

  out = out.replace(/```(\w*)[^`]*```/g, (_all, lang: string) => {
    const name = LANGUAGE_NAMES[lang?.toLowerCase()] ?? (lang ? lang : "");
    return name ? ` …there's a ${name} code block here… ` : " …there's a code block here… ";
  });

  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_a, alt: string) => (alt ? ` an image: ${alt} ` : " an image "));
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/https?:\/\/\S+/g, " a link ");

  out = out.replace(/`([^`]+)`/g, (_a, code: string) => (code.length <= 40 ? code : " a code snippet "));

  out = out.replace(/^#{1,6}\s*(.+)$/gm, "$1.");
  out = out.replace(/^\s*[-*+]\s+/gm, "");
  out = out.replace(/^\s*\d+\.\s+/gm, "");
  out = out.replace(/^\s*>\s?/gm, "");
  out = out.replace(/^[-*_]{3,}\s*$/gm, "");
  out = out.replace(/(\*\*|__|\*|_|~~)/g, "");

  out = out.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, "");
  out = out.replace(/^\s*\|(.+)\|\s*$/gm, (_a, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", "),
  );

  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "");

  out = out
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return /[\p{L}\p{N}]/u.test(out) ? out : "";
}

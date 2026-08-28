export function routeSpokenToRoom(text: string, memberNames: string[]): string {
  const said = text.trim();
  const lead = said.replace(/^(hey|hi|ok|okay)[,\s]+/i, "");
  const sorted = [...memberNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = lead.match(new RegExp(`^${escaped}[,.!?\\s]+(.*)$`, "i"));
    if (match) return `@${name} ${match[1]}`.trim();
  }
  return said;
}

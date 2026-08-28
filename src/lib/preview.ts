import type { Message } from "@/state/reducer";

export function plainText(text: string): string {
  return text
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-•*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function describeComponent(component: Record<string, unknown>): string {
  const named = typeof component.title === "string" ? component.title.trim() : "";
  switch (component.kind) {
    case "chart":
      return named || "A chart";
    case "table":
      return named || "A table";
    case "decision":
      return typeof component.question === "string" ? component.question : "A recommendation";
    case "steps":
      return named || "Some steps";
    case "quote":
      return typeof component.text === "string" ? component.text : "A quote";
    case "refused":
      return typeof component.what === "string" ? `Refused: ${component.what}` : "Refused";
    default:
      return "An answer";
  }
}

export function previewLine(last: Message | undefined): string {
  if (!last) return "New agent";
  if (last.deleted) return "Message taken back";
  switch (last.kind) {
    case "options":
      return last.card ? last.card.title : "Asked you something";
    case "activity":
      return last.tool ? last.tool.name : "Working";
    case "screen":
      return "Shared a screen frame";
    case "artifact":
      return last.artifact ? `Saved ${last.artifact.name}` : "Saved a file";
    case "connector":
      return last.connector ? `Connect ${last.connector.label}` : "Connect an app";
    case "secret":
      return last.secret ? `Needs your ${last.secret.label}` : "Needs a key";
    case "component":
      return last.component ? describeComponent(last.component) : "An answer";
    default:
      return last.text ? plainText(last.text) : "";
  }
}

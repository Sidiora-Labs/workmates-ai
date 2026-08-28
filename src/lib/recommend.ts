export const WORK_TYPES = [
  { id: "building", label: "Building software", hint: "Code, reviews, shipping" },
  { id: "writing", label: "Writing", hint: "Drafts, docs, posts" },
  { id: "selling", label: "Sales and outreach", hint: "Pipeline, follow-ups" },
  { id: "marketing", label: "Marketing", hint: "Campaigns, content, growth" },
  { id: "support", label: "Customer support", hint: "Tickets, answers, escalations" },
  { id: "research", label: "Research", hint: "Reading, comparing, summarising" },
  { id: "running", label: "Running a company", hint: "The whole week at once" },
  { id: "admin", label: "Email and admin", hint: "Inbox, calendar, chasing" },
] as const;

export type WorkTypeId = (typeof WORK_TYPES)[number]["id"];

const BY_WORK: Record<WorkTypeId, string[]> = {
  building: ["engineer", "research-analyst", "writer"],
  writing: ["writer", "research-analyst", "personal-assistant"],
  selling: ["sales-outbound", "inbox-manager", "chief-of-staff"],
  marketing: ["growth-marketer", "writer", "research-analyst"],
  support: ["support", "inbox-manager", "ops"],
  research: ["research-analyst", "writer", "personal-assistant"],
  running: ["chief-of-staff", "ops", "bookkeeper"],
  admin: ["inbox-manager", "personal-assistant", "chief-of-staff"],
};

const FALLBACK = ["personal-assistant", "research-analyst", "writer"];

export function recommendedFor(chosen: readonly string[], limit = 3): string[] {
  const lists = chosen
    .filter((id): id is WorkTypeId => id in BY_WORK)
    .map((id) => BY_WORK[id]);
  if (lists.length === 0) return FALLBACK.slice(0, limit);

  const out: string[] = [];
  for (let rank = 0; rank < 3 && out.length < limit; rank++) {
    for (const list of lists) {
      const candidate = list[rank];
      if (candidate && !out.includes(candidate)) out.push(candidate);
      if (out.length >= limit) break;
    }
  }
  for (const spare of FALLBACK) {
    if (out.length >= limit) break;
    if (!out.includes(spare)) out.push(spare);
  }
  return out.slice(0, limit);
}

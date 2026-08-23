export interface Draft {
  name?: string;
  title?: string;
  description?: string;
  skills: string[];
}

export const DRAFT_LIMITS = {
  name: 32,
  title: 72,
  description: 1_200,
  skill: 200,
  skills: 6,
} as const;

export function draftPrompt(description: string): string {
  return [
    `Set up an AI agent whose job is: "${description.trim()}".`,
    "",
    "Reply with labelled lines and nothing else. Use these labels exactly:",
    "NAME: a short human-style role name, 1 to 3 words, title case",
    "TITLE: what they do, under 8 words, no full stop",
    "PERSONA: 2 to 4 sentences addressed to the agent as 'You are...'. Say what they own, how they work, and what they never do.",
    "SKILL: one concrete thing they do, written as 'Doing the thing: how it is done'",
    "",
    "Give between 3 and 5 SKILL lines. Do not number them. Do not add any other labels.",
  ].join("\n");
}

const strip = (value: string) => value.replace(/^["'\s]+|["'\s]+$/g, "").trim();

export function parseDraft(raw: string): Draft {
  const draft: Draft = { skills: [] };
  const personaLines: string[] = [];
  let inPersona = false;

  for (const line of raw.split("\n")) {
    const labelled = line.match(/^\s*(NAME|TITLE|PERSONA|SKILL)\s*:\s*(.*)$/i);
    if (labelled) {
      const label = labelled[1].toUpperCase();
      const value = strip(labelled[2]);
      inPersona = label === "PERSONA";
      if (label === "NAME" && value) draft.name = value;
      else if (label === "TITLE" && value) draft.title = value.replace(/\.$/, "");
      else if (label === "PERSONA" && value) personaLines.push(value);
      else if (label === "SKILL" && value) draft.skills.push(value.replace(/^[-*\d.\s]+/, ""));
      continue;
    }
    if (inPersona && line.trim()) personaLines.push(strip(line));
  }

  if (personaLines.length) draft.description = personaLines.join(" ").trim();
  return clampDraft(draft);
}

export function clampDraft(draft: Draft): Draft {
  const cut = (value: string | undefined, max: number) =>
    value && value.length <= max ? value : value?.slice(0, max).trim();
  return {
    ...(draft.name ? { name: cut(draft.name, DRAFT_LIMITS.name)! } : {}),
    ...(draft.title ? { title: cut(draft.title, DRAFT_LIMITS.title)! } : {}),
    ...(draft.description ? { description: cut(draft.description, DRAFT_LIMITS.description)! } : {}),
    skills: draft.skills
      .map((skill) => cut(skill, DRAFT_LIMITS.skill)!)
      .filter(Boolean)
      .slice(0, DRAFT_LIMITS.skills),
  };
}

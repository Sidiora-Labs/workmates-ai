export interface FreshnessInput {
  instanceId: string;
  lastInstanceId?: string;
  resumeCursors: Record<string, unknown>;
  hasUserTurn: boolean;
}

export function engineIsFresh(input: FreshnessInput): boolean {
  if (!input.hasUserTurn) return false;
  if (input.lastInstanceId !== undefined) return input.lastInstanceId !== input.instanceId;
  const holders = Object.keys(input.resumeCursors).filter(
    (id) => input.resumeCursors[id] !== undefined,
  );
  return !(holders.length === 1 && holders[0] === input.instanceId);
}

export function freshTurnText(
  transcript: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  turnText: string,
): string {
  if (transcript.length === 0) return turnText;
  const history = transcript
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n\n");
  return `You are picking up this conversation mid-thread; a different engine handled it until now. The conversation so far:\n\n${history}\n\n--- the new message ---\n\n${turnText}`;
}

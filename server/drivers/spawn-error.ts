export interface SpawnContext {
  name: string;
  command: string;
  install?: string;
  signIn?: string;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function describeSpawnError(error: unknown, ctx: SpawnContext): string {
  const code = (error as NodeJS.ErrnoException)?.code;

  if (isMissing(error)) {
    const next = ctx.install
      ? ` Install it with ${ctx.install}${ctx.signIn ? `, then ${ctx.signIn}` : ""}.`
      : "";
    return (
      `${ctx.name} is not installed, so this agent has nothing to think with.` +
      `${next} You can also connect a different engine in Settings.`
    );
  }

  if (code === "EACCES" || code === "EPERM") {
    return `${ctx.name} is installed but not runnable: \`${ctx.command}\` was found and permission was denied.`;
  }

  if (code === "EMFILE" || code === "ENFILE") {
    return `This machine is out of file handles, so ${ctx.name} could not start. Closing some apps usually fixes it.`;
  }

  const detail = error instanceof Error ? error.message : String(error);
  return `${ctx.name} could not start: ${detail}`;
}

export function describeEarlyExit(
  code: number | null,
  stderr: string,
  ctx: Pick<SpawnContext, "name" | "signIn">,
): string {
  const said = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(-300);

  if (/not logged in|unauthor|authenticat|api key|credential|sign in/i.test(said)) {
    return `${ctx.name} is not signed in.${ctx.signIn ? ` To fix it, ${ctx.signIn}.` : ""}${
      said ? ` It said: ${said}` : ""
    }`;
  }

  if (said) return `${ctx.name} stopped early: ${said}`;
  return `${ctx.name} stopped early with exit code ${code ?? "unknown"} and said nothing.`;
}

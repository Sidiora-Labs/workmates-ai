import type { AnyProviderDriver } from "../core/contracts.ts";
import { CUSTOM_SPEC, PROVIDER_SPECS } from "../integrations/providers.ts";
import { acpDriver, ACP_SPECS } from "./acp.ts";
import { AntigravityDriver } from "./antigravity.ts";
import { BoxAgentDriver } from "./boxagent.ts";
import { ClaudeDriver } from "./claude.ts";
import { CodexDriver } from "./codex.ts";
import { openAiCompatDriver } from "./openai-compat.ts";

export const BUILT_IN_DRIVERS: readonly AnyProviderDriver[] = [
  ...PROVIDER_SPECS.map(openAiCompatDriver),
  openAiCompatDriver(CUSTOM_SPEC),
  ...ACP_SPECS.map(acpDriver),
  AntigravityDriver,
  ClaudeDriver,
  CodexDriver,
  BoxAgentDriver,
];

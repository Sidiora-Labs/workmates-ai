import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureDirs, instanceConfigs, NATIVE_DIR } from "../server/core/config.ts";
import { openAiCompatDriver } from "../server/drivers/openai-compat.ts";
import { specFor } from "../server/integrations/providers.ts";
import type { RuntimeEvent } from "../server/core/contracts.ts";

const configPath = process.env.WORKMATES_VERIFY_CONFIG;
const boxId = process.env.WORKMATES_VERIFY_BOX;
if (!configPath || !boxId) throw new Error("Set WORKMATES_VERIFY_CONFIG and WORKMATES_VERIFY_BOX for an isolated real-provider check.");
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const entry = Object.values(instanceConfigs(cfg)).find((e) => e.driver === "openrouter");
assert.ok(entry && cfg.box?.token);
ensureDirs();
const driver = openAiCompatDriver(specFor("openrouter")!);
const instance = await driver.create({ instanceId: "loop-qualification", displayName: "Loop qualification", enabled: true,
  environment: entry.environment ?? {}, config: driver.decodeConfig(entry.config) });
const model = process.env.WORKMATES_VERIFY_MODEL || "openai/gpt-5.4-mini";

async function run(text: string, cancelOn?: "tool" | "question") {
  const threadId = randomUUID();
  const events: RuntimeEvent[] = [];
  let timer: ReturnType<typeof setTimeout>;
  let unsubscribe: () => void;
  const done = new Promise<RuntimeEvent & { type: "turn.completed" }>((resolve, reject) => {
    timer = setTimeout(() => { void instance.adapter.interruptTurn(threadId); reject(new Error("Live qualification timed out")); }, 240_000);
    unsubscribe = instance.adapter.onEvent((event) => {
      if (event.threadId !== threadId) return;
      events.push(event);
      if (event.type === "item.completed" && event.itemType === "tool") {
        console.log(`completed tool ${events.filter(e => e.type === "item.completed" && e.itemType === "tool").length}`);
        if (cancelOn === "tool") void instance.adapter.interruptTurn(threadId);
      }
      if (event.type === "request.opened" && cancelOn === "question") void instance.adapter.interruptTurn(threadId);
      if (event.type === "turn.completed") resolve(event);
    });
  });
  try {
    await instance.adapter.sendTurn({ threadId, text, model,
      system: "Follow the verification steps exactly. Execute one tool call per assistant response and wait for its result before requesting the next. Never combine commands or tool calls. Do not modify files or open browsers.",
      integrations: { computer: { boxId: boxId!, token: cfg.box.token } } });
    const terminal = await done;
    const native = readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const toolRounds = native.filter(e => e.dir === "in" && e.source === "openrouter.chat.completions" && e.msg.message?.tool_calls?.length).length;
    const finals = events.filter((e): e is RuntimeEvent & { type: "item.completed"; text: string } => e.type === "item.completed" && e.itemType === "assistant_text" && Boolean(e.text));
    const started = events.filter(e => e.type === "item.started" && e.itemType === "tool").length;
    assert.equal(instance.adapter.hasSession(threadId), false);
    return { terminal, toolRounds, started, finals, events, outcomes: native.filter(e => e.source === "openrouter.tool").map(e => e.msg.content) };
  } finally { clearTimeout(timer!); unsubscribe!(); }
}

try {
  const full = await run("Run exactly 12 computer_exec calls, sequentially in 12 separate assistant responses. Each command must print the previous call's UUID, then generate a new one with cat /proc/sys/kernel/random/uuid. For the first command use START in place of the previous UUID. Wait for the returned UUID before constructing the next command, so these calls cannot be combined. Number each command from 1 through 12 in its printf output. After all 12 successful results, respond with LOOP_COMPLETE_12. Do not stop early and do not ask questions.");
  console.log(JSON.stringify({ toolRounds: full.toolRounds, toolCalls: full.started, final: full.finals.map(f => f.text), outcomes: full.outcomes }));
  assert.equal(full.terminal.ok, true);
  assert.equal(full.toolRounds, 12);
  assert.equal(full.started, 12);
  assert.equal(full.finals.length, 1);
  assert.match(full.finals[0].text, /LOOP_COMPLETE_12/);
  assert.equal(full.events.filter(e => e.type === "item.completed" && e.itemType === "tool" && e.ok === false).length, 0);
  console.log("Twelve real provider/tool rounds and one final response passed");
  const stopped = await run("Run computer_exec with printf 'stop-check-1\\n', then after its result run computer_exec with printf 'stop-check-2\\n'.", "tool");
  assert.equal(stopped.started, 1);
  assert.equal(stopped.terminal.ok, false);
  assert.equal(stopped.terminal.stopReason, "interrupted");
  const question = await run("Use ask_user to ask 'May I continue the verification?' and wait for the answer. Do not run commands.", "question");
  assert.equal(question.terminal.stopReason, "interrupted");
  assert.equal(question.started, 1);
  console.log(JSON.stringify({ model, realToolRounds: full.toolRounds, finalResponses: full.finals.length,
    stopPreventedNextTool: true, stopReleasedPendingQuestion: true }));
} finally { await instance.dispose(); }

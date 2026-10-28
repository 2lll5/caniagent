import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";
import { isolatedProbeEnvironment } from "./probe-env.js";

export const STRUCTURED_OUTPUT_SPECS = {
  codex: { format: "jsonl", versionArgs: ["--version"], args: (prompt) => ["exec", "--ephemeral", "--skip-git-repo-check", "--json", prompt] },
  "claude-code": { format: "json", versionArgs: ["--version"], args: (prompt) => ["-p", prompt, "--output-format", "json"] },
  "gemini-cli": { format: "json", versionArgs: ["--version"], args: (prompt) => ["-p", prompt, "--output-format", "json"] },
  opencode: { format: "jsonl", versionArgs: ["--version"], args: (prompt) => ["run", "--format", "json", prompt] }
};

export function parseStructuredOutput(output, format) {
  const text = output.trim();
  if (!text) throw new Error("structured output was empty");
  if (format === "json") return [JSON.parse(text)];
  if (format === "jsonl") {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) throw new Error("structured output was empty");
    return lines.map((line) => JSON.parse(line));
  }
  throw new Error(`Unknown structured output format: ${format}`);
}

// Only known model-response fields are admissible. Input echoes and arbitrary
// nested metadata are never sufficient to prove that the model replied.
export function modelResponseTexts(value, agent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  if (agent === "codex") return value.type === "item.completed" && value.item?.type === "agent_message" && typeof value.item.text === "string" ? [value.item.text] : [];
  if (agent === "opencode") return value.type === "text" && value.part?.type === "text" && typeof value.part.text === "string" ? [value.part.text] : [];
  if (agent === "claude-code") return value.type === "result" && value.is_error !== true && typeof value.result === "string" ? [value.result] : [];
  if (agent === "gemini-cli") return (!value.type || value.type === "result") && value.is_error !== true && typeof value.response === "string" ? [value.response] : [];
  // Unknown named adapters must not inherit the direct-parser fallback.
  if (agent !== undefined) return [];
  // Backward-compatible, conservative fallback for direct parser callers.
  // Production probes always supply the agent adapter.
  // Reject errors and unknown response envelopes, but preserve known event adapters.
  if (value.is_error === true) return [];
  if ((!value.type || value.type === "result") && typeof value.response === "string") return [value.response];
  if (value.type === "result" && typeof value.result === "string") return [value.result];
  if (value.type === "result" && typeof value.text === "string") return [value.text];
  if (value.type === "item.completed" && value.item?.type === "agent_message" && typeof value.item.text === "string") return [value.item.text];
  if (value.type === "text" && value.part?.type === "text" && typeof value.part.text === "string") return [value.part.text];
  return [];
}

// Never accept a prior model message as a successful result when the same
// structured stream explicitly reports a failed turn or an error result.
function hasExplicitStructuredFailure(value, agent) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.is_error === true) return true;
  // Gemini headless JSON reports failed requests in a non-null error envelope.
  // Direct-parser callers must also reject that envelope, even on exit code zero.
  if ((agent === "gemini-cli" || agent === undefined) &&
      (!value.type || value.type === "result") && value.error != null) return true;
  // A terminal failure invalidates prior response markers for every adapter,
  // including callers that omit the agent name.
  if (value.type === "error" || value.type === "turn.failed") return true;
  if (value.type === "result" && typeof value.subtype === "string" &&
      value.subtype.startsWith("error_")) return true;
  return false;
}

export function classifyStructuredOutput(output, format, marker, executionOutcome = "success", agent) {
  if (executionOutcome !== "success") return { parseable: false, markerObserved: false, verdict: "inconclusive" };
  let values;
  try {
    values = parseStructuredOutput(output, format);
  } catch {
    return { parseable: false, markerObserved: false, verdict: "fail" };
  }
  // A structured failure event invalidates an earlier marker even if the
  // wrapper process exits successfully (some CLIs return zero on turn errors).
  const failed = values.some((value) => hasExplicitStructuredFailure(value, agent));
  // The final model response, not an earlier intermediate message, must
  // match the marker. Later diagnostic events do not replace model replies.
  const finalResponse = values.reduce((last, value, index) => {
    const texts = modelResponseTexts(value, agent);
    return texts.length ? { text: texts[texts.length - 1], index } : last;
  }, null);
  // OpenCode v2 can omit the final step_finish event (upstream #53207).
  // Do not require that event, but do reject an observed nonterminal finish
  // after the final model reply.
  const lastOpenCodeFinish = agent === "opencode" ? values.reduce((last, value, index) => {
    return value?.type === "step_finish" && value.part?.type === "step-finish"
      ? { index, reason: value.part.reason } : last;
  }, null) : null;
  const incompleteOpenCodeFinish = lastOpenCodeFinish !== null &&
    lastOpenCodeFinish.index > (finalResponse?.index ?? -1) &&
    lastOpenCodeFinish.reason !== "stop";
  // A new step may start after an earlier step completed successfully.
  // Never reuse the earlier reply when that newer step has no model text.
  // Missing final step_finish remains tolerated for OpenCode v2.
  const lastOpenCodeStartIndex = agent === "opencode"
    ? values.findLastIndex((value) => value?.type === "step_start" && value.part?.type === "step-start")
    : -1;
  const staleOpenCodeResponse = lastOpenCodeStartIndex > (finalResponse?.index ?? -1);
  // A tool invocation after the marker means the model has not supplied the
  // final response to that activity. OpenCode may omit the final step_finish.
  const staleOpenCodeTool = agent === "opencode" &&
    values.findLastIndex((value) => value?.type === "tool_use") > (finalResponse?.index ?? -1);
  // Missing or blank markers are not evidence; optional chaining alone would
  // otherwise treat an absent response and an undefined marker as equal.
  // Codex emits turn.completed only after a successful turn. A zero-exit
  // process with a matching item but no terminal event is not enough evidence.
  const codexCompleted = agent !== "codex" || (() => {
    const lastResponseIndex = values.findLastIndex((value) => modelResponseTexts(value, agent).length > 0);
    const lastStartIndex = values.findLastIndex((value) => value?.type === "turn.started");
    const lastCompletedIndex = values.findLastIndex((value) => value?.type === "turn.completed");
    // A later turn can complete without producing a model reply. Do not
    // certify an earlier turn's marker as the final response in that case.
    // A later tool event or non-fatal error item makes the earlier marker stale
    // until the model replies again, even if the turn subsequently completes.
    const lastNonResponseActivityIndex = values.findLastIndex((value) =>
      ["item.started", "item.updated", "item.completed"].includes(value?.type) &&
      ["command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search", "error"].includes(value.item?.type));
    return lastCompletedIndex > lastResponseIndex &&
      lastCompletedIndex > lastStartIndex &&
      (lastStartIndex < 0 || lastResponseIndex > lastStartIndex) &&
      lastResponseIndex > lastNonResponseActivityIndex;
  })();
  const markerObserved = !failed && codexCompleted && !incompleteOpenCodeFinish &&
    !staleOpenCodeResponse && !staleOpenCodeTool &&
    typeof marker === "string" && marker.trim().length > 0 &&
    typeof finalResponse?.text === "string" && finalResponse.text === marker;
  return { parseable: true, markerObserved, verdict: markerObserved ? "pass" : "inconclusive" };
}

function run(command, args, { cwd, env, timeout = 60000, onStdout } = {}) {
  // Valid JSON/JSONL can exceed Node's 1 MiB default sync buffer.
  // Keep capture bounded; only redacted/truncated evidence is persisted.
  const result = spawnSync(command, args, {
    cwd, env, encoding: "utf8", timeout, shell: process.platform === "win32",
    maxBuffer: 8 * 1024 * 1024
  });
  const outcome = classifyProbeExecution(result);
  // Classify the unmodified stdout before evidence redaction/truncation.
  // Only the small classification result escapes this callback.
  onStdout?.(result.stdout ?? "", outcome);
  return {
    command: redactProbeOutput([command, ...args].join(" ")),
    outcome,
    status: result.status,
    signal: result.signal,
    stdout: redactAndTruncateProbeOutput(result.stdout ?? ""),
    stderr: redactAndTruncateProbeOutput(result.stderr ?? ""),
    error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
  };
}

// Raw stdout is never added to the returned execution object or persisted artifact.
export function runStructuredOutput(command, args, { format, marker, agent, ...options }) {
  let classification;
  const execution = run(command, args, {
    ...options,
    onStdout: (rawStdout, outcome) => {
      classification = classifyStructuredOutput(rawStdout, format, marker, outcome, agent);
    }
  });
  return { execution, ...classification };
}


function main() {
  const matrix = loadMatrix();
  const observedAt = new Date().toISOString();
  const results = [];
  for (const agent of matrix.agents) {
    const spec = STRUCTURED_OUTPUT_SPECS[agent.id];
    if (!spec) {
      results.push({ agent: agent.id, observedAt, verdict: "unknown", reason: "No documented structured-output adapter is encoded in this probe." });
      continue;
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-structured-${agent.id}-`));
    try {
      const home = path.join(temp, "home");
      const workspace = path.join(temp, "workspace");
      fs.mkdirSync(home, { recursive: true });
      fs.mkdirSync(workspace, { recursive: true });
      const env = isolatedProbeEnvironment(home);
      const marker = `CANIAGENT_STRUCTURED_${agent.id.replaceAll("-", "_").toUpperCase()}`;
      const prompt = `Reply with exactly this marker and nothing else: ${marker}`;
      const version = run(agent.command, spec.versionArgs, { cwd: workspace, env, timeout: 8000 });
      const structured = runStructuredOutput(agent.command, spec.args(prompt), {
        cwd: workspace, env, format: spec.format, marker, agent: agent.id
      });
      results.push({
        agent: agent.id,
        observedAt,
        format: spec.format,
        version,
        ...structured
      });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  const output = { schemaVersion: 1, probe: "structured-output", observedAt, platform: process.platform, arch: process.arch, node: process.version, results };
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  if (outputArg) {
    const value = outputArg.slice("--output=".length);
    if (!value) throw new Error("--output requires a non-empty path");
    const outputPath = path.resolve(value);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
    console.log(outputPath);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();

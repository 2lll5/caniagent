import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";
import { isolatedProbeEnvironment } from "./probe-env.js";

export const SKILL_PROBE_SPECS = {
  codex: { projectPath: [".agents", "skills"], userPath: [".agents", "skills"], versionArgs: ["--version"], outputFormat: "codex-result-jsonl", args: (prompt) => ["exec", "--ephemeral", "--skip-git-repo-check", "--json", prompt] },
  "claude-code": { projectPath: [".claude", "skills"], userPath: [".claude", "skills"], versionArgs: ["--version"], outputFormat: "claude-result-json", args: (prompt) => ["-p", prompt, "--output-format", "json"] },
  "gemini-cli": { projectPath: [".gemini", "skills"], userPath: [".gemini", "skills"], versionArgs: ["--version"], outputFormat: "gemini-result-json", args: (prompt) => ["--approval-mode=yolo", "-p", prompt, "--output-format", "json"] },
  opencode: { projectPath: [".opencode", "skills"], userPath: [".config", "opencode", "skills"], versionArgs: ["--version"], outputFormat: "opencode-result-jsonl", args: (prompt) => ["run", "--format", "json", prompt] }
};

export function createSkillFixture(baseDir, agentId, scope = "project") {
  const spec = SKILL_PROBE_SPECS[agentId];
  if (!spec) throw new Error(`No Agent Skills probe adapter for ${agentId}`);
  const scopePath = scope === "project" ? spec.projectPath : scope === "user" ? spec.userPath : undefined;
  if (!scopePath) throw new Error(`No ${scope}-scope Agent Skills discovery path for ${agentId}`);
  // A predictable marker can be reconstructed from the skill name without
  // loading SKILL.md. Use a fresh 128-bit challenge for each fixture.
  const marker = `CANIAGENT_SKILL_${randomBytes(16).toString("hex").toUpperCase()}`;
  const skillName = `caniagent-probe-${agentId}-${scope}`;
  const workspace = path.join(baseDir, "workspace");
  const root = scope === "project" ? workspace : path.join(baseDir, "home");
  const skillDir = path.join(root, ...scopePath, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), "# CanIAgent Agent Skills probe fixture\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    `name: ${skillName}`,
    "description: CanIAgent skill discovery probe. Use when explicitly asked to run the CanIAgent skill discovery probe.",
    "---",
    "",
    `When invoked for the CanIAgent skill discovery probe, reply with exactly: ${marker}`,
    ""
  ].join("\n"));
  const discoveryPath = scope === "project"
    ? path.relative(workspace, skillDir).split(path.sep).join("/") + "/"
    : `~/${[...scopePath, skillName].join("/")}/`;
  return { workspace, skillDir, skillName, marker, discoveryPath };
}

export function classifySkillOutput(output, marker, executionOutcome = "success", outputFormat = "text") {
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  if (executionOutcome !== "success" || !marker) return inconclusive;
  if (outputFormat === "codex-result-jsonl") {
    let events;
    try { events = output.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
    catch { return inconclusive; }
    // Codex --json emits events, not just the final answer. Require the
    // terminal turn.completed directly after a completed agent_message;
    // prior prompt/tool echoes, stale turns and failed streams cannot pass.
    if (events.some((event) => !event || typeof event !== "object" ||
      Array.isArray(event) || event.type === "turn.failed" ||
      event.type === "error" || event.type === "item.failed" ||
      // A tool can finish with an error inside item.completed. A successful
      // final model reply must not conceal a failed/declined tool invocation.
      (event.type === "item.completed" && (
        event.item?.status === "failed" || event.item?.status === "declined" ||
        (event.item?.type === "command_execution" &&
          Number.isInteger(event.item.exit_code) && event.item.exit_code !== 0) ||
        (event.item?.type === "mcp_tool_call" && event.item.error != null)
      )))) return inconclusive;
    const completed = events.length - 1;
    const started = events.findLastIndex((event) => event.type === "turn.started");
    const reply = events[completed - 1];
    if (started < 0 || started >= completed - 1 ||
      events[completed]?.type !== "turn.completed" ||
      reply?.type !== "item.completed" || reply.item?.type !== "agent_message" ||
      typeof reply.item.text !== "string") return inconclusive;
    return reply.item.text.trim() === marker
      ? { discovered: true, verdict: "pass" } : inconclusive;
  }
  if (outputFormat === "opencode-result-jsonl") {
    let events;
    try { events = output.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
    catch { return inconclusive; }
    // Only final model text can establish the marker; reject stale steps,
    // later tool activity, explicit failures and incomplete terminal steps.
    if (events.some((event) => !event || typeof event !== "object" ||
      Array.isArray(event) || event.type === "error" ||
      event.is_error === true || event.part?.type === "error")) return inconclusive;
    // OpenCode can emit pending/running tool updates before completion.
    // A final model reply cannot certify a skill while a tool is unresolved.
    // Correlate updates by callID; unknown or unidentifiable states fail closed.
    const toolStates = new Map();
    for (const event of events) {
      if (event.type !== "tool_use") continue;
      const part = event.part;
      const status = part?.state?.status;
      if (part?.type !== "tool" || part?.state?.error != null ||
        !["pending", "running", "completed"].includes(status)) return inconclusive;
      const callID = part.callID;
      if (status !== "completed" && (typeof callID !== "string" || !callID)) return inconclusive;
      if (typeof callID === "string" && callID) toolStates.set(callID, status);
    }
    if ([...toolStates.values()].some((status) => status !== "completed")) return inconclusive;
    const replyIndex = events.findLastIndex((event) => event.type === "text" &&
      event.part?.type === "text" && typeof event.part.text === "string");
    // A model reply must belong to an active step, not a bare event or
    // text emitted after an already-finished step without a new start.
    const startIndex = events.findLastIndex((event) => event.type === "step_start" &&
      event.part?.type === "step-start");
    const finishedBeforeReply = events.findLastIndex((event, index) =>
      index < replyIndex && event.type === "step_finish" &&
      event.part?.type === "step-finish");
    if (replyIndex < 0 || startIndex < 0 || startIndex > replyIndex ||
      finishedBeforeReply > startIndex ||
      events.findLastIndex((event) => event.type === "tool_use") > replyIndex) return inconclusive;
    const finishIndex = events.findLastIndex((event) => event.type === "step_finish" &&
      event.part?.type === "step-finish");
    // OpenCode v2 may omit a final step_finish; an observed finish must be stop.
    if (finishIndex > replyIndex && events[finishIndex].part.reason !== "stop") return inconclusive;
    // A clean exit may omit step_finish, but any other event after the
    // final text makes its provenance ambiguous; fail closed.
    if (events.slice(replyIndex + 1).some((event) =>
      event.type !== "step_finish" || event.part?.type !== "step-finish" ||
      event.part.reason !== "stop")) return inconclusive;
    return events[replyIndex].part.text === marker
      ? { discovered: true, verdict: "pass" } : inconclusive;
  }
  if (outputFormat === "claude-result-json") {
    let value;
    try { value = JSON.parse(output); } catch { return inconclusive; }
    // Only the terminal Claude result can establish a model reply.
    // Tool/prompt echoes and error results are never discovery evidence.
    const finalReply = value && typeof value === "object" && !Array.isArray(value) &&
      value.type === "result" && value.is_error !== true &&
      !(typeof value.subtype === "string" && value.subtype.startsWith("error_")) &&
      typeof value.result === "string" ? value.result : undefined;
    return finalReply?.trim() === marker ? { discovered: true, verdict: "pass" } : inconclusive;
  }
  if (outputFormat === "gemini-result-json") {
    let value;
    try { value = JSON.parse(output); } catch { return inconclusive; }
    // Gemini headless JSON's top-level response is the final model answer.
    // Reject errors, tool echoes, and unrelated event envelopes.
    const finalReply = value && typeof value === "object" && !Array.isArray(value) &&
      (!value.type || value.type === "result") && value.is_error !== true &&
      value.error == null && typeof value.response === "string" ? value.response : undefined;
    return finalReply?.trim() === marker ? { discovered: true, verdict: "pass" } : inconclusive;
  }
  if (outputFormat !== "text") return inconclusive;
  // Other CLIs still have only provisional terminal-line evidence.
  return output.trimEnd().split(/\r?\n/).at(-1)?.trim() === marker
    ? { discovered: true, verdict: "pass" } : inconclusive;
}

// Classify the original stdout before redaction/truncation; never persist it.
export function captureSkillProbeResult(result, command, args, marker, outputFormat = "text") {
  const outcome = classifyProbeExecution(result);
  return {
    execution: {
      command: redactProbeOutput([command, ...args].join(" ")),
      outcome,
      status: result.status,
      signal: result.signal,
      stdout: redactAndTruncateProbeOutput(result.stdout ?? ""),
      stderr: redactAndTruncateProbeOutput(result.stderr ?? ""),
      error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
    },
    markerVerdict: marker === undefined ? undefined : classifySkillOutput(result.stdout ?? "", marker, outcome, outputFormat)
  };
}

export function runSkillProbe(command, args, { cwd, env, timeout = 60000, marker, outputFormat = "text" } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, shell: process.platform === "win32", maxBuffer: 8 * 1024 * 1024 });
  return captureSkillProbeResult(result, command, args, marker, outputFormat);
}


function main() {
  const matrix = loadMatrix();
  const observedAt = new Date().toISOString();
  const results = [];
  for (const agent of matrix.agents) {
    const spec = SKILL_PROBE_SPECS[agent.id];
    if (!spec) {
      results.push({ agent: agent.id, observedAt, verdict: "unknown", reason: "No documented Agent Skills discovery path is encoded in this probe." });
      continue;
    }
    const scopes = ["project", ...(spec.userPath ? ["user"] : [])];
    for (const scope of scopes) {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-skills-${agent.id}-${scope}-`));
      try {
        const home = path.join(temp, "home");
        fs.mkdirSync(home, { recursive: true });
        const env = isolatedProbeEnvironment(home);
        const fixture = createSkillFixture(temp, agent.id, scope);
        const { execution: version } = runSkillProbe(agent.command, spec.versionArgs, { cwd: fixture.workspace, env, timeout: 8000 });
        const prompt = `Run the ${fixture.skillName} skill for the CanIAgent skill discovery probe. Reply with only the result required by that skill; do not search the filesystem for skill files.`;
        const { execution, markerVerdict } = runSkillProbe(agent.command, spec.args(prompt), { cwd: fixture.workspace, env, marker: fixture.marker, outputFormat: spec.outputFormat });
        results.push({
          agent: agent.id,
          observedAt,
          scope,
          discoveryPath: fixture.discoveryPath,
          version,
          execution,
          ...markerVerdict
        });
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  }
  const output = { schemaVersion: 1, probe: "agent-skills", observedAt, platform: process.platform, arch: process.arch, node: process.version, results };
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

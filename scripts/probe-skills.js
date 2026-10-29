import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  const readmeContent = "# CanIAgent Agent Skills probe fixture\n";
  fs.writeFileSync(path.join(workspace, "README.md"), readmeContent);
  const skillContent = [
    "---",
    `name: ${skillName}`,
    "description: CanIAgent skill discovery probe. Use when explicitly asked to run the CanIAgent skill discovery probe.",
    "---",
    "",
    `When invoked for the CanIAgent skill discovery probe, reply with exactly: ${marker}`,
    ""
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillContent);
  const discoveryPath = scope === "project"
    ? path.relative(workspace, skillDir).split(path.sep).join("/") + "/"
    : `~/${[...scopePath, skillName].join("/")}/`;
  // Hash the logical fixture (path + file contents) without persisting its random challenge.
  const fixtureSha256 = createHash("sha256").update(JSON.stringify({
    discoveryPath, readme: readmeContent, skill: skillContent
  })).digest("hex");
  return { workspace, skillDir, skillName, marker, discoveryPath, fixtureSha256 };
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
        ["failed", "declined", "error", "cancelled", "canceled",
          "pending", "running", "in_progress"].includes(event.item?.status) ||
        (event.item?.type === "command_execution" && (
          event.item.error != null ||
          (event.item.exit_code != null &&
            (!Number.isInteger(event.item.exit_code) || event.item.exit_code !== 0))
        )) ||
        (event.item?.type === "mcp_tool_call" && event.item.error != null)
      )))) return inconclusive;
    // A terminal model reply must not hide an unfinished tool invocation.
    // Match known tool lifecycle events by item ID; missing IDs on started
    // tools are ambiguous and therefore cannot establish a passing verdict.
    const unfinishedTools = new Map();
    const toolTypes = new Set(["command_execution", "mcp_tool_call", "web_search", "file_change"]);
    for (const event of events) {
      if (!toolTypes.has(event.item?.type)) continue;
      if (event.type === "item.started") {
        const id = event.item.id;
        if (typeof id !== "string" || !id || unfinishedTools.has(id)) return inconclusive;
        unfinishedTools.set(id, event.item.type);
      } else if (event.type === "item.completed" && typeof event.item.id === "string" &&
        unfinishedTools.has(event.item.id)) {
        // A completed event for a different tool type cannot close this call.
        if (unfinishedTools.get(event.item.id) !== event.item.type) return inconclusive;
        unfinishedTools.delete(event.item.id);
      }
    }
    if (unfinishedTools.size) return inconclusive;
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
    // All structured events must belong to one session. A mixed-session
    // stream cannot establish that the final model text came from this probe.
    const sessionIds = new Set();
    for (const event of events) {
      const envelopeId = event.sessionID;
      const partId = event.part?.sessionID;
      if ((envelopeId != null && (typeof envelopeId !== "string" || !envelopeId)) ||
        (partId != null && (typeof partId !== "string" || !partId)) ||
        (envelopeId && partId && envelopeId !== partId)) return inconclusive;
      if (envelopeId) sessionIds.add(envelopeId);
      if (partId) sessionIds.add(partId);
    }
    if (sessionIds.size > 1) return inconclusive;
    // OpenCode can emit pending/running tool updates before completion.
    // A final model reply cannot certify a skill while a tool is unresolved.
    // Correlate updates by callID; unknown or unidentifiable states fail closed.
    const toolStates = new Map();
    for (const event of events) {
      if (event.type !== "tool_use") continue;
      const part = event.part;
      const status = part?.state?.status;
      // A completed shell tool may still have failed with a nonzero exit code.
      const exitCode = part?.state?.metadata?.exit;
      if (part?.type !== "tool" || part?.state?.error != null ||
        (exitCode != null && exitCode !== 0) ||
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
// The random fixture challenge is evidence-only: do not serialize it even if
// an agent echoes SKILL.md in stdout, stderr, its command, or diagnostics.
function redactSkillMarker(value, marker) {
  const text = String(value ?? "");
  return typeof marker === "string" && marker.length > 0
    ? text.replaceAll(marker, "<SKILL_MARKER>")
    : text;
}

export function captureSkillProbeResult(result, command, args, marker, outputFormat = "text") {
  const outcome = classifyProbeExecution(result);
  return {
    execution: {
      command: redactProbeOutput(redactSkillMarker([command, ...args].join(" "), marker)),
      outcome,
      status: result.status,
      signal: result.signal,
      stdout: redactAndTruncateProbeOutput(redactSkillMarker(result.stdout, marker)),
      stderr: redactAndTruncateProbeOutput(redactSkillMarker(result.stderr, marker)),
      error: result.error?.message ? redactProbeOutput(redactSkillMarker(result.error.message, marker)) : undefined
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
          fixtureSha256: fixture.fixtureSha256,
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

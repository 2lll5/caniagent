import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";

export const STRUCTURED_OUTPUT_SPECS = {
  codex: { format: "jsonl", versionArgs: ["--version"], args: (prompt) => ["exec", "--ephemeral", "--json", prompt] },
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

export function classifyStructuredOutput(output, format, marker, executionOutcome = "success") {
  if (executionOutcome !== "success") return { parseable: false, markerObserved: false, verdict: "inconclusive" };
  let values;
  try {
    values = parseStructuredOutput(output, format);
  } catch {
    return { parseable: false, markerObserved: false, verdict: "fail" };
  }
  const markerObserved = values.some((value) => JSON.stringify(value).includes(marker));
  return { parseable: true, markerObserved, verdict: markerObserved ? "pass" : "inconclusive" };
}

function run(command, args, { cwd, env, timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, shell: process.platform === "win32" });
  return {
    command: redactProbeOutput([command, ...args].join(" ")),
    outcome: classifyProbeExecution(result),
    status: result.status,
    signal: result.signal,
    stdout: redactAndTruncateProbeOutput(result.stdout ?? ""),
    stderr: redactAndTruncateProbeOutput(result.stderr ?? ""),
    error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
  };
}

function isolatedEnvironment(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state")
  };
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
      const env = isolatedEnvironment(home);
      const marker = `CANIAGENT_STRUCTURED_${agent.id.replaceAll("-", "_").toUpperCase()}`;
      const prompt = `Reply with exactly this marker and nothing else: ${marker}`;
      const version = run(agent.command, spec.versionArgs, { cwd: workspace, env, timeout: 8000 });
      const execution = run(agent.command, spec.args(prompt), { cwd: workspace, env });
      results.push({
        agent: agent.id,
        observedAt,
        format: spec.format,
        version,
        execution,
        ...classifyStructuredOutput(execution.stdout, spec.format, marker, execution.outcome)
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

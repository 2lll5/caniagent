import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";

export const NESTED_PROBE_SPECS = {
  codex: { file: "AGENTS.md", args: (prompt) => ["exec", "--ephemeral", prompt] },
  "claude-code": { file: "CLAUDE.md", args: (prompt) => ["-p", prompt] },
  "gemini-cli": { file: "GEMINI.md", args: (prompt) => ["-p", prompt] },
  opencode: { file: "AGENTS.md", args: (prompt) => ["run", prompt] }
};

export function createNestedInstructionFixture(baseDir, agentId) {
  const spec = NESTED_PROBE_SPECS[agentId];
  if (!spec) throw new Error(`No nested-instruction probe adapter for ${agentId}`);
  const suffix = agentId.replaceAll("-", "_").toUpperCase();
  const rootMarker = `CANIAGENT_ROOT_${suffix}`;
  const nestedMarker = `CANIAGENT_NESTED_${suffix}`;
  const workspace = path.join(baseDir, "workspace");
  const nested = path.join(workspace, "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(workspace, spec.file), `When asked for CanIAgent instruction markers, include exactly this marker: ${rootMarker}\n`);
  fs.writeFileSync(path.join(nested, spec.file), `When asked for CanIAgent instruction markers, include exactly this marker: ${nestedMarker}\n`);
  fs.writeFileSync(path.join(workspace, "README.md"), "# CanIAgent nested-instruction probe fixture\n");
  return { workspace, nested, rootMarker, nestedMarker, file: spec.file };
}

export function classifyNestedMarkers(output, { rootMarker, nestedMarker }) {
  const root = output.includes(rootMarker);
  const nested = output.includes(nestedMarker);
  if (!root && !nested) return { root, nested, verdict: "inconclusive" };
  if (root && nested) return { root, nested, verdict: "root-and-nested" };
  return { root, nested, verdict: root ? "root-only" : "nested-only" };
}

function run(command, args, { cwd, env, timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, shell: process.platform === "win32" });
  const outcome = classifyProbeExecution(result);
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
    const spec = NESTED_PROBE_SPECS[agent.id];
    if (!spec) continue;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-nested-${agent.id}-`));
    try {
      const home = path.join(temp, "home");
      fs.mkdirSync(home, { recursive: true });
      const fixture = createNestedInstructionFixture(temp, agent.id);
      const prompt = "Reply with only the CanIAgent instruction marker tokens that apply in this directory. Do not inspect files with tools. Do not explain.";
      const execution = run(agent.command, spec.args(prompt), { cwd: fixture.nested, env: isolatedEnvironment(home) });
      const combined = `${execution.stdout}\n${execution.stderr}`;
      results.push({
        agent: agent.id,
        observedAt,
        instructionFile: fixture.file,
        execution,
        markers: execution.outcome === "success"
          ? classifyNestedMarkers(combined, fixture)
          : { root: false, nested: false, verdict: "inconclusive" }
      });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  const output = { schemaVersion: 1, probe: "nested-instructions", observedAt, platform: process.platform, arch: process.arch, node: process.version, results };
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

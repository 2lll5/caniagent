import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";
import { isolatedProbeEnvironment } from "./probe-env.js";

export const NESTED_PROBE_SPECS = {
  codex: { file: "AGENTS.md", versionArgs: ["--version"], args: (prompt) => ["exec", "--ephemeral", "--skip-git-repo-check", prompt] },
  "claude-code": { file: "CLAUDE.md", versionArgs: ["--version"], args: (prompt) => ["-p", prompt] },
  "gemini-cli": { file: "GEMINI.md", versionArgs: ["--version"], args: (prompt) => ["-p", prompt] },
  opencode: { file: "AGENTS.md", versionArgs: ["--version"], args: (prompt) => ["run", prompt] }
};

export function createNestedInstructionFixture(baseDir, agentId) {
  const spec = NESTED_PROBE_SPECS[agentId];
  if (!spec) throw new Error(`No nested-instruction probe adapter for ${agentId}`);
  const suffix = agentId.replaceAll("-", "_").toUpperCase();
  // Fresh per-run challenge prevents stale or memorized marker matches.
  const challenge = randomBytes(12).toString("hex").toUpperCase();
  const rootMarker = `CANIAGENT_ROOT_${suffix}_${challenge}`;
  const nestedMarker = `CANIAGENT_NESTED_${suffix}_${challenge}`;
  const workspace = path.join(baseDir, "workspace");
  const nested = path.join(workspace, "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(workspace, spec.file), `When asked for CanIAgent instruction markers, include exactly this marker: ${rootMarker}\n`);
  fs.writeFileSync(path.join(nested, spec.file), `When asked for CanIAgent instruction markers, include exactly this marker: ${nestedMarker}\n`);
  fs.writeFileSync(path.join(workspace, "README.md"), "# CanIAgent nested-instruction probe fixture\n");
  return { workspace, nested, rootMarker, nestedMarker, file: spec.file };
}

export function classifyNestedMarkers(output, { rootMarker, nestedMarker }) {
  // Only an exact terminal line is provisional evidence. CLI diagnostics
  // and instruction-file echoes elsewhere in stdout must not count.
  const lines = output.trimEnd().split(/\r?\n/);
  const finalLine = lines.at(-1)?.trim() ?? "";
  const earlierOutput = lines.slice(0, -1).join("\n");
  const tokens = finalLine ? finalLine.split(/\s+/) : [];
  const valid = !earlierOutput.includes(rootMarker) && !earlierOutput.includes(nestedMarker) &&
    tokens.length > 0 && tokens.length <= 2 &&
    new Set(tokens).size === tokens.length &&
    tokens.every((token) => token === rootMarker || token === nestedMarker);
  const root = valid && tokens.includes(rootMarker);
  const nested = valid && tokens.includes(nestedMarker);
  if (!root && !nested) return { root, nested, verdict: "inconclusive" };
  if (root && nested) return { root, nested, verdict: "root-and-nested" };
  return { root, nested, verdict: root ? "root-only" : "nested-only" };
}

export function classifyNestedEvidence({ outcome, stdout }, fixture) {
  return outcome === "success"
    ? classifyNestedMarkers(stdout, fixture)
    : { root: false, nested: false, verdict: "inconclusive" };
}

function run(command, args, { cwd, env, timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, shell: process.platform === "win32" });
  const outcome = classifyProbeExecution(result);
  return {
    record: {
      command: redactProbeOutput([command, ...args].join(" ")),
      outcome,
      status: result.status,
      signal: result.signal,
      stdout: redactAndTruncateProbeOutput(result.stdout ?? ""),
      stderr: redactAndTruncateProbeOutput(result.stderr ?? ""),
      error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
    },
    // Raw stdout is used only for classification, never persisted in the report.
    rawStdout: result.stdout ?? ""
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
      const env = isolatedProbeEnvironment(home);
      const fixture = createNestedInstructionFixture(temp, agent.id);
      const { record: version } = run(agent.command, spec.versionArgs, { cwd: fixture.workspace, env, timeout: 8000 });
      const prompt = "Reply with only the CanIAgent instruction marker tokens that apply in this directory, on one line separated by a space if both apply. Do not inspect files with tools. Do not explain.";
      const { record: execution, rawStdout } = run(agent.command, spec.args(prompt), { cwd: fixture.nested, env });
      results.push({
        agent: agent.id,
        observedAt,
        instructionFile: fixture.file,
        version,
        execution,
        markers: classifyNestedEvidence({ outcome: execution.outcome, stdout: rawStdout }, fixture)
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

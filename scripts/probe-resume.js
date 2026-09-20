import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";

export const RESUME_SPECS = {
  codex: {
    versionArgs: ["--version"],
    firstArgs: (prompt) => ["exec", "--skip-git-repo-check", prompt],
    resumeArgs: (prompt) => ["exec", "resume", "--last", prompt]
  },
  "claude-code": {
    versionArgs: ["--version"],
    firstArgs: (prompt) => ["-p", prompt],
    resumeArgs: (prompt) => ["-p", "--continue", prompt]
  },
  "gemini-cli": {
    versionArgs: ["--version"],
    firstArgs: (prompt) => ["-p", prompt],
    resumeArgs: (prompt) => ["-r", "latest", prompt]
  },
  opencode: {
    versionArgs: ["--version"],
    firstArgs: (prompt) => ["run", prompt],
    resumeArgs: (prompt) => ["run", "--continue", prompt]
  }
};

export function classifyResume(firstOutcome, resumedOutcome, resumedOutput, marker) {
  if (firstOutcome !== "success" || resumedOutcome !== "success") {
    return { markerObserved: false, verdict: "inconclusive" };
  }
  const markerObserved = resumedOutput.includes(marker);
  return { markerObserved, verdict: markerObserved ? "pass" : "fail" };
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
    const spec = RESUME_SPECS[agent.id];
    if (!spec) {
      results.push({ agent: agent.id, observedAt, verdict: "unknown", reason: "No documented resume adapter is encoded in this probe." });
      continue;
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-resume-${agent.id}-`));
    try {
      const home = path.join(temp, "home");
      const workspace = path.join(temp, "workspace");
      fs.mkdirSync(home, { recursive: true });
      fs.mkdirSync(workspace, { recursive: true });
      const env = isolatedEnvironment(home);
      const marker = `CANIAGENT_RESUME_${agent.id.replaceAll("-", "_").toUpperCase()}`;
      const firstPrompt = `Remember this exact token for the next turn: ${marker}. Reply only with OK.`;
      const resumePrompt = "Reply only with the exact token I asked you to remember in the previous turn.";
      const version = run(agent.command, spec.versionArgs, { cwd: workspace, env, timeout: 8000 });
      const first = run(agent.command, spec.firstArgs(firstPrompt), { cwd: workspace, env });
      const resumed = first.outcome === "success"
        ? run(agent.command, spec.resumeArgs(resumePrompt), { cwd: workspace, env })
        : { command: redactProbeOutput([agent.command, ...spec.resumeArgs(resumePrompt)].join(" ")), outcome: "not-run", status: null, signal: null, stdout: "", stderr: "" };
      results.push({
        agent: agent.id,
        observedAt,
        version,
        first,
        resumed,
        ...classifyResume(first.outcome, resumed.outcome, resumed.stdout, marker)
      });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  const output = { schemaVersion: 1, probe: "resume-session", observedAt, platform: process.platform, arch: process.arch, node: process.version, results };
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

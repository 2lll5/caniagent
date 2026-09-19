import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";

const matrix = loadMatrix();
const now = new Date().toISOString();

function run(command, args, timeout = 8000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    shell: process.platform === "win32"
  });
  const outcome = classifyProbeExecution(result);
  return {
    command: redactProbeOutput([command, ...args].join(" ")),
    ok: outcome === "success",
    outcome,
    status: result.status,
    signal: result.signal,
    stdout: redactAndTruncateProbeOutput(result.stdout ?? ""),
    stderr: redactAndTruncateProbeOutput(result.stderr ?? ""),
    error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
  };
}

const results = [];
for (const agent of matrix.agents) {
  const version = run(agent.command, ["--version"]);
  const installed = version.outcome !== "not_found";
  const interrupted = version.outcome === "timeout" || version.outcome === "signaled";
  const help = installed && !interrupted ? run(agent.command, ["--help"]) : null;
  results.push({
    agent: agent.id,
    command: agent.command,
    observedAt: now,
    installed,
    version,
    help
  });
}

const output = {
  schemaVersion: 1,
  observedAt: now,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  results
};

const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
if (outputArg) {
  const outputPath = path.resolve(outputArg.slice("--output=".length));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(outputPath);
} else {
  console.log(JSON.stringify(output, null, 2));
}

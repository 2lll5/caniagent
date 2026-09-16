import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadMatrix } from "../src/core.js";
import { redactProbeOutput } from "./probe-utils.js";

const matrix = loadMatrix();
const now = new Date().toISOString();

function run(command, args, timeout = 8000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    shell: process.platform === "win32"
  });
  return {
    command: [command, ...args].join(" "),
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: redactProbeOutput((result.stdout ?? "").slice(0, 12000)),
    stderr: redactProbeOutput((result.stderr ?? "").slice(0, 12000)),
    error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
  };
}

const results = [];
for (const agent of matrix.agents) {
  const version = run(agent.command, ["--version"]);
  const help = version.error ? null : run(agent.command, ["--help"]);
  results.push({
    agent: agent.id,
    command: agent.command,
    observedAt: now,
    installed: !version.error,
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

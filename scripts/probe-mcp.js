import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";

const SERVER_PATH = fileURLToPath(new URL("./mcp-echo-server.js", import.meta.url));
export const MCP_MARKER = "CANIAGENT_MCP_ECHO_OK";

export const MCP_PROBE_SPECS = {
  codex: { args: (prompt) => ["exec", "--ephemeral", prompt] },
  "claude-code": { args: (prompt) => ["-p", prompt] },
  "gemini-cli": { args: (prompt) => ["-p", prompt] },
  opencode: { args: (prompt) => ["run", prompt] }
};

export function createMcpFixture(baseDir, agentId, serverPath = SERVER_PATH) {
  const workspace = path.join(baseDir, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const command = process.execPath;
  const args = [serverPath];
  if (agentId === "codex") {
    fs.mkdirSync(path.join(baseDir, "home", ".codex"), { recursive: true });
    fs.writeFileSync(path.join(baseDir, "home", ".codex", "config.toml"), `[mcp_servers.caniagent_echo]\ncommand = ${JSON.stringify(command)}\nargs = [${args.map((arg) => JSON.stringify(arg)).join(", ")}]\n`);
  } else if (agentId === "claude-code") {
    fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { caniagent_echo: { command, args } } }, null, 2));
  } else if (agentId === "gemini-cli") {
    fs.mkdirSync(path.join(workspace, ".gemini"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { caniagent_echo: { command, args, trust: true } } }, null, 2));
  } else if (agentId === "opencode") {
    fs.writeFileSync(path.join(workspace, "opencode.json"), JSON.stringify({ mcp: { caniagent_echo: { type: "local", command: [command, ...args], enabled: true } } }, null, 2));
  } else {
    throw new Error(`No MCP probe adapter for ${agentId}`);
  }
  return { workspace, command, args };
}

export function classifyMcpResult(execution) {
  if (execution.outcome === "not_found") return "skip";
  if (execution.outcome !== "success") return "inconclusive";
  return `${execution.stdout}\n${execution.stderr}`.includes(MCP_MARKER) ? "pass" : "fail";
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
  return { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local", "share"), XDG_STATE_HOME: path.join(home, ".local", "state") };
}

function main() {
  const observedAt = new Date().toISOString();
  const results = [];
  for (const agent of loadMatrix().agents) {
    const spec = MCP_PROBE_SPECS[agent.id];
    if (!spec) continue;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-mcp-${agent.id}-`));
    try {
      const home = path.join(temp, "home");
      fs.mkdirSync(home, { recursive: true });
      const fixture = createMcpFixture(temp, agent.id);
      const env = isolatedEnvironment(home);
      const version = run(agent.command, ["--version"], { cwd: fixture.workspace, env, timeout: 8000 });
      const prompt = `Call the caniagent_echo MCP tool exactly once with text ${MCP_MARKER}. Reply with only the tool result.`;
      const execution = version.outcome === "not_found"
        ? { command: agent.command, outcome: "not_found", status: null, signal: null, stdout: "", stderr: "" }
        : run(agent.command, spec.args(prompt), { cwd: fixture.workspace, env });
      results.push({ agent: agent.id, observedAt, version, execution, verdict: classifyMcpResult(execution) });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  const output = { schemaVersion: 1, probe: "mcp-stdio", observedAt, platform: process.platform, arch: process.arch, node: process.version, results };
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  if (outputArg) {
    const value = outputArg.slice("--output=".length);
    if (!value) throw new Error("--output requires a non-empty path");
    const outputPath = path.resolve(value);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
    console.log(outputPath);
  } else console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();

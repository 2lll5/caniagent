import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise all four adapter fixture/CLI paths with local stand-ins. This does
// not test real vendor behavior or establish compatibility-matrix evidence.
test("MCP probe resolves every vendor fixture and classifies real stdio calls", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-adapters-"));
  const bin = path.join(temp, "bin");
  const probe = fileURLToPath(new URL("../scripts/probe-mcp.js", import.meta.url));
  const windows = process.platform === "win32";
  const adapters = [
    ["codex", "codex", ["exec", "--ephemeral", "--skip-git-repo-check"]],
    ["claude-code", "claude", ["-p"]],
    ["gemini-cli", "gemini", ["-p"]],
    ["opencode", "opencode", ["run"]]
  ];
  try {
    fs.mkdirSync(bin);
    for (const [agent, command, prefix] of adapters) {
      const executable = path.join(bin, windows ? `${command}.cmd` : command);
      const script = windows ? path.join(temp, `${command}.cjs`) : executable;
      fs.writeFileSync(script, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const agent = ${JSON.stringify(agent)};
const prefix = ${JSON.stringify(prefix)};
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("fake-" + agent + " 1.0"); process.exit(0); }
if (args.length <= prefix.length || prefix.some((value, i) => args[i] !== value)
    || !args.slice(prefix.length).join(" ").includes(process.env.CANIAGENT_MCP_EXPECTED_TEXT)) process.exit(4);
const home = process.env.HOME;
if (process.env.CODEX_HOME !== path.join(home, ".codex")
    || process.env.CLAUDE_CONFIG_DIR !== path.join(home, ".claude")) process.exit(5);
let server;
if (agent === "codex") {
  if (fs.existsSync(path.join(process.cwd(), ".git"))) process.exit(10);
  const toml = fs.readFileSync(path.join(process.env.CODEX_HOME, "config.toml"), "utf8");
  const command = toml.match(/^command = (.+)$/m);
  const argumentsLine = toml.match(/^args = (.+)$/m);
  if (!command || !argumentsLine) process.exit(6);
  server = { command: JSON.parse(command[1]), args: JSON.parse(argumentsLine[1]) };
} else if (agent === "claude-code") {
  server = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".mcp.json"), "utf8"))
    .mcpServers.caniagent_echo;
} else if (agent === "gemini-cli") {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".gemini", "settings.json"), "utf8"))
    .mcpServers.caniagent_echo;
  if (config.trust !== true) process.exit(11);
  server = config;
} else {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "opencode.json"), "utf8"))
    .mcp.caniagent_echo;
  if (config.type !== "local" || config.enabled !== true) process.exit(7);
  server = { command: config.command[0], args: config.command.slice(1) };
}
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
  protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-cli", version: "1" }
} };
const notification = { jsonrpc: "2.0", method: "notifications/initialized" };
const list = { jsonrpc: "2.0", id: 3, method: "tools/list" };
const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
  name: "caniagent_echo", arguments: { text: process.env.CANIAGENT_MCP_EXPECTED_TEXT }
} };
const requests = process.env.MOCK_MCP_MODE === "zero-call"
  ? [initialize, notification] : [initialize, notification, list, call];
const child = spawnSync(server.command, server.args, {
  input: requests.map(JSON.stringify).join("\\n") + "\\n",
  encoding: "utf8", env: process.env, timeout: 5000
});
if (child.error || child.status !== 0) {
  process.stderr.write(child.error?.message || child.stderr || "server failed");
  process.exit(8);
}
if (process.env.MOCK_MCP_MODE !== "zero-call") {
  const replies = child.stdout.trim().split("\\n").map(JSON.parse);
  if (replies.at(-2)?.result?.tools?.[0]?.name !== "caniagent_echo"
      || replies.at(-1)?.result?.content?.[0]?.text !== process.env.CANIAGENT_MCP_EXPECTED_TEXT)
    process.exit(9);
}
console.log("fake " + agent + " completed");
`);
      if (windows) {
        fs.writeFileSync(executable, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
      } else {
        fs.chmodSync(executable, 0o755);
      }
    }
    for (const [mode, verdict, count] of [
      ["valid-call", "pass", 1], ["zero-call", "fail", 0]
    ]) {
      const child = spawnSync(process.execPath, [probe], {
        cwd: temp, encoding: "utf8", timeout: 30000,
        env: { ...process.env, PATH: bin, CODEX_HOME: path.join(temp, "external-codex"),
          CLAUDE_CONFIG_DIR: path.join(temp, "external-claude"), MOCK_MCP_MODE: mode }
      });
      assert.equal(child.status, 0, `${mode}: ${child.stderr || child.error?.message}`);
      const output = JSON.parse(child.stdout);
      for (const [agent] of adapters) {
        const result = output.results.find((entry) => entry.agent === agent);
        assert.ok(result, `${mode}: missing ${agent}`);
        assert.equal(result.version.outcome, "success", `${mode}: ${agent} version`);
        assert.equal(result.execution.outcome, "success", `${mode}: ${agent} ${result.execution.stderr}`);
        assert.equal(result.serverInitialized, true, `${mode}: ${agent} handshake`);
        assert.equal(result.toolCallsObserved, count, `${mode}: ${agent} call count`);
        assert.equal(result.verdict, verdict, `${mode}: ${agent} verdict`);
      }
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

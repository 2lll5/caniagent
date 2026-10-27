import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// This is a local fake CLI integration test, not provider-backed compatibility evidence.
test("MCP probe CLI classifies server-side calls rather than echoed prompts", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-e2e-"));
  const bin = path.join(temp, "bin");
  const probe = fileURLToPath(new URL("../scripts/probe-mcp.js", import.meta.url));
  try {
    fs.mkdirSync(bin);
    const windows = process.platform === "win32";
    const fakeClaude = path.join(bin, windows ? "claude.cmd" : "claude");
    const fakeScript = windows ? path.join(temp, "fake-claude.cjs") : fakeClaude;
    fs.writeFileSync(fakeScript, `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
if (process.argv.includes("--version")) {
  console.log("fake-claude 1.0");
  process.exit(0);
}
const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".mcp.json"), "utf8"));
const server = fixture.mcpServers.caniagent_echo;
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: {
  protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-cli", version: "1" }
} };
const notification = { jsonrpc: "2.0", method: "notifications/initialized" };
const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: {
  name: "caniagent_echo", arguments: { text: process.env.CANIAGENT_MCP_EXPECTED_TEXT }
} };
const mode = process.env.MOCK_MCP_MODE;
const requests = mode === "echo-only" ? [] : mode === "zero-call"
  ? [initialize, notification] : [initialize, notification, call];
const child = spawnSync(server.command, server.args, {
  input: requests.map(JSON.stringify).join("\\n") + "\\n", encoding: "utf8",
  env: process.env, timeout: 5000
});
if (child.error || child.status !== 0) {
  process.stderr.write(child.error?.message || child.stderr || "server failed");
  process.exit(2);
}
if (mode === "valid-call") {
  const replies = child.stdout.trim().split("\\n").map(JSON.parse);
  if (replies.at(-1)?.result?.content?.[0]?.text !== process.env.CANIAGENT_MCP_EXPECTED_TEXT) {
    process.exit(3);
  }
}
// An echoed marker alone must never establish a successful MCP tool call.
console.log(mode === "echo-only" ? process.env.CANIAGENT_MCP_EXPECTED_TEXT : "fake CLI finished");
`);
    if (windows) {
      // Windows resolves .cmd shims through PATHEXT; avoid requiring a POSIX shebang.
      fs.writeFileSync(fakeClaude, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`);
    } else {
      fs.chmodSync(fakeClaude, 0o755);
    }
    for (const [mode, verdict, initialized, count] of [
      ["valid-call", "pass", true, 1],
      ["zero-call", "fail", true, 0],
      ["echo-only", "inconclusive", false, null]
    ]) {
      const child = spawnSync(process.execPath, [probe], {
        cwd: temp, encoding: "utf8", timeout: 20000,
        env: { ...process.env, PATH: bin, MOCK_MCP_MODE: mode }
      });
      assert.equal(child.status, 0, `${mode}: ${child.stderr || child.error?.message}`);
      const output = JSON.parse(child.stdout);
      const claude = output.results.find((result) => result.agent === "claude-code");
      assert.ok(claude, `${mode}: missing fake provider result`);
      assert.equal(claude.verdict, verdict, mode);
      assert.equal(claude.serverInitialized, initialized, mode);
      assert.equal(claude.toolCallsObserved, count, mode);
      for (const other of output.results.filter((result) => result.agent !== "claude-code")) {
        // Windows shell:true reports missing commands as a nonzero shell exit, not ENOENT.
        // PATH contains only our fake CLI, so no other provider can be executed.
        assert.equal(other.verdict, windows ? "inconclusive" : "skip",
          `${mode}: ${other.agent} must not run a real CLI`);
        assert.notEqual(other.version.outcome, "success", `${mode}: ${other.agent} unexpectedly resolved`);
      }
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

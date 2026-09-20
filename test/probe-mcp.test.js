import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleMcpMessage, TOOL_NAME } from "../scripts/mcp-echo-server.js";
import { MCP_MARKER, createMcpFixture, classifyMcpResult } from "../scripts/probe-mcp.js";

test("MCP echo server exposes and calls deterministic tool", () => {
  const listed = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(listed.result.tools[0].name, TOOL_NAME);
  const called = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: TOOL_NAME, arguments: { text: MCP_MARKER } } });
  assert.equal(called.result.content[0].text, MCP_MARKER);
});

test("MCP probe classifies pass, fail, skip, and inconclusive", () => {
  assert.equal(classifyMcpResult({ outcome: "success", stdout: MCP_MARKER, stderr: "" }), "pass");
  assert.equal(classifyMcpResult({ outcome: "success", stdout: "no marker", stderr: "" }), "fail");
  assert.equal(classifyMcpResult({ outcome: "not_found", stdout: "", stderr: "" }), "skip");
  assert.equal(classifyMcpResult({ outcome: "failed", stdout: "", stderr: "auth required" }), "inconclusive");
});

test("MCP fixtures configure only isolated project/home paths", () => {
  for (const agent of ["codex", "claude-code", "gemini-cli", "opencode"]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-mcp-test-${agent}-`));
    try {
      createMcpFixture(temp, agent, "/tmp/echo-server.js");
      const expected = {
        codex: path.join(temp, "home", ".codex", "config.toml"),
        "claude-code": path.join(temp, "workspace", ".mcp.json"),
        "gemini-cli": path.join(temp, "workspace", ".gemini", "settings.json"),
        opencode: path.join(temp, "workspace", "opencode.json")
      }[agent];
      assert.equal(fs.existsSync(expected), true, `${agent} fixture missing`);
      assert.match(fs.readFileSync(expected, "utf8"), /caniagent_echo/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleMcpMessage, TOOL_NAME } from "../scripts/mcp-echo-server.js";
import { MCP_MARKER, createMcpFixture, classifyMcpResult, isolatedMcpEnvironment } from "../scripts/probe-mcp.js";

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

test("MCP probe overrides inherited vendor config homes without mutating the caller environment", () => {
  const home = path.join(os.tmpdir(), "caniagent-mcp-isolation with spaces");
  const inherited = Object.freeze({
    CODEX_HOME: "/external/codex",
    CLAUDE_CONFIG_DIR: "/external/claude",
    XDG_CONFIG_HOME: "/external/config",
    SENTINEL: "preserve-me"
  });
  const env = isolatedMcpEnvironment(home, inherited);

  assert.equal(env.CODEX_HOME, path.join(home, ".codex"));
  assert.equal(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"));
  assert.equal(env.HOME, home);
  assert.equal(env.USERPROFILE, home);
  assert.equal(env.XDG_CONFIG_HOME, path.join(home, ".config"));
  assert.equal(env.XDG_DATA_HOME, path.join(home, ".local", "share"));
  assert.equal(env.XDG_STATE_HOME, path.join(home, ".local", "state"));
  assert.equal(env.SENTINEL, "preserve-me");
  assert.equal(inherited.CODEX_HOME, "/external/codex");
  assert.equal(inherited.CLAUDE_CONFIG_DIR, "/external/claude");
});

test("MCP Codex fixture resides under the isolated CODEX_HOME and Claude keeps project config", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-isolated-fixture-"));
  try {
    const home = path.join(temp, "home");
    const env = isolatedMcpEnvironment(home, { CODEX_HOME: "/external/codex", CLAUDE_CONFIG_DIR: "/external/claude" });
    createMcpFixture(temp, "codex", "/tmp/echo-server.js");
    assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "config.toml")), true);
    createMcpFixture(temp, "claude-code", "/tmp/echo-server.js");
    assert.equal(fs.existsSync(path.join(temp, "workspace", ".mcp.json")), true);
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

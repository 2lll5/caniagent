import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleMcpMessage, TOOL_NAME } from "../scripts/mcp-echo-server.js";
import { MCP_MARKER, createMcpFixture, classifyMcpResult } from "../scripts/probe-mcp.js";
import { isolatedProbeEnvironment } from "../scripts/probe-env.js";

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
  const env = isolatedProbeEnvironment(home, inherited);

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

test("MCP probe child process observes isolated vendor config paths", () => {
  const home = path.join(os.tmpdir(), "caniagent-mcp-child with spaces");
  const inherited = Object.freeze({
    CODEX_HOME: "/external/codex",
    CLAUDE_CONFIG_DIR: "/external/claude",
    SENTINEL: "preserved"
  });
  const env = isolatedProbeEnvironment(home, inherited);
  const child = spawnSync(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify({ codex: process.env.CODEX_HOME, claude: process.env.CLAUDE_CONFIG_DIR, sentinel: process.env.SENTINEL }))"
  ], { env, encoding: "utf8", timeout: 5000 });

  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    codex: path.join(home, ".codex"),
    claude: path.join(home, ".claude"),
    sentinel: "preserved"
  });
  assert.equal(inherited.CODEX_HOME, "/external/codex");
  assert.equal(inherited.CLAUDE_CONFIG_DIR, "/external/claude");
});

test("MCP probe strips Node preloads and mixed-case vendor/Windows aliases", () => {
  const home = path.join(os.tmpdir(), "caniagent-mcp-extra with spaces");
  const inherited = Object.freeze({
    codex_home: "/outside/codex",
    claude_config_dir: "/outside/claude",
    appdata: "/outside/appdata",
    localappdata: "/outside/local",
    xdg_cache_home: "/outside/cache",
    nOdE_oPtIoNs: "--require=__caniagent_nonexistent_preload__",
    NODE_OPTIONS: "--require=__caniagent_nonexistent_preload__",
    SENTINEL: "preserved"
  });
  const env = isolatedProbeEnvironment(home, inherited);
  for (const key of [
    "HOME", "USERPROFILE", "CODEX_HOME", "CLAUDE_CONFIG_DIR",
    "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
    "XDG_STATE_HOME", "XDG_CACHE_HOME"
  ]) {
    assert.equal(Object.keys(env).filter((name) => name.toUpperCase() === key).length, 1, key);
    assert.ok(env[key].startsWith(home), key);
  }
  assert.equal(Object.keys(env).some((key) => key.toUpperCase() === "NODE_OPTIONS"), false);
  assert.equal(env.SENTINEL, "preserved");
  assert.equal(inherited.codex_home, "/outside/codex");
  const child = spawnSync(process.execPath, ["-e", 'process.stdout.write("MCP_OK")'], {
    env, encoding: "utf8", timeout: 5000
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "MCP_OK");
});

test("MCP Codex fixture resides under the isolated CODEX_HOME and Claude keeps project config", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-isolated-fixture-"));
  try {
    const home = path.join(temp, "home");
    const env = isolatedProbeEnvironment(home, { CODEX_HOME: "/external/codex", CLAUDE_CONFIG_DIR: "/external/claude" });
    createMcpFixture(temp, "codex", "/tmp/echo-server.js");
    assert.equal(fs.existsSync(path.join(env.CODEX_HOME, "config.toml")), true);
    createMcpFixture(temp, "claude-code", "/tmp/echo-server.js");
    assert.equal(fs.existsSync(path.join(temp, "workspace", ".mcp.json")), true);
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

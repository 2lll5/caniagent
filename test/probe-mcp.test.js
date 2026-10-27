import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleMcpMessage, TOOL_NAME } from "../scripts/mcp-echo-server.js";
import { MCP_MARKER, createMcpFixture, classifyMcpResult, classifyMcpEvidence, readMcpReceipt, readMcpInitialization } from "../scripts/probe-mcp.js";
import { isolatedProbeEnvironment } from "../scripts/probe-env.js";

test("MCP echo server exposes and calls deterministic tool", () => {
  const listed = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(listed.result.tools[0].name, TOOL_NAME);
  const called = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: TOOL_NAME, arguments: { text: MCP_MARKER } } });
  assert.equal(called.result.content[0].text, MCP_MARKER);
  const extra = handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: TOOL_NAME, arguments: { text: MCP_MARKER, extra: "unexpected" } } });
  assert.equal(extra.error.code, -32602, "additionalProperties: false must be enforced");
});

test("MCP probe classifies pass, fail, skip, and inconclusive", () => {
  assert.equal(classifyMcpResult({ outcome: "success", stdout: MCP_MARKER, stderr: "" }, [{ name: "caniagent_echo", matched: true }]), "pass");
  assert.equal(classifyMcpResult({ outcome: "success", stdout: "no marker", stderr: "" }), "fail");
  assert.equal(classifyMcpResult({ outcome: "not_found", stdout: "", stderr: "" }), "skip");
  assert.equal(classifyMcpResult({ outcome: "failed", stdout: "", stderr: "auth required" }), "inconclusive");
});

test("MCP prompt echoes never count as tool-call evidence", () => {
  const execution = { outcome: "success", stdout: `Prompt: ${MCP_MARKER}`, stderr: MCP_MARKER };
  assert.equal(classifyMcpResult(execution), "fail");
  assert.equal(classifyMcpResult(execution, [{ name: "caniagent_echo", matched: false }]), "fail");
  assert.equal(classifyMcpResult(execution, [{ name: "other", matched: true }]), "fail");
  assert.equal(classifyMcpResult(execution, [
    { name: "caniagent_echo", matched: true }, { name: "caniagent_echo", matched: true }
  ]), "fail");
  assert.equal(classifyMcpResult(execution, [{ name: "caniagent_echo", matched: true }]), "pass");
});

test("MCP server records rejected and valid tool-call attempts without exposing arguments", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-receipt-"));
  try {
    const request = (name, text) => JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { text } }
    });
    const serverPath = fileURLToPath(new URL("../scripts/mcp-echo-server.js", import.meta.url));
    const runRequests = (requests, receiptPath) => {
      const run = spawnSync(process.execPath, [serverPath], {
        input: requests.join("\n") + "\n", encoding: "utf8", timeout: 5000,
        env: { ...process.env, CANIAGENT_MCP_RECEIPT_PATH: receiptPath,
          CANIAGENT_MCP_EXPECTED_TEXT: MCP_MARKER }
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.trim().split("\n").length, requests.length);
      return fs.readFileSync(receiptPath, "utf8").trim().split("\n").map(JSON.parse);
    };
    const attempts = runRequests([
      request("wrong-tool", MCP_MARKER),
      request(TOOL_NAME, null),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: TOOL_NAME, arguments: { text: MCP_MARKER, extra: "unexpected" } } }),
      request(TOOL_NAME, MCP_MARKER)
    ], path.join(temp, "rejected.jsonl"));
    assert.deepEqual(attempts, [
      { name: null, matched: false },
      { name: TOOL_NAME, matched: false },
      { name: TOOL_NAME, matched: false },
      { name: TOOL_NAME, matched: true }
    ]);
    assert.equal(attempts.some((entry) => Object.hasOwn(entry, "text")), false);
    assert.equal(classifyMcpResult({ outcome: "success" }, attempts), "fail");

    const valid = runRequests([request(TOOL_NAME, MCP_MARKER)], path.join(temp, "valid.jsonl"));
    assert.deepEqual(valid, [{ name: TOOL_NAME, matched: true }]);
    assert.equal(classifyMcpResult({ outcome: "success" }, valid), "pass");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("MCP calls before initialize never become passing evidence", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-call-order-"));
  const serverPath = fileURLToPath(new URL("../scripts/mcp-echo-server.js", import.meta.url));
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "test", version: "1" } } };
  const call = { jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: TOOL_NAME, arguments: { text: MCP_MARKER } } };
  const runSequence = (requests, suffix) => {
    const receiptPath = path.join(temp, `receipt-${suffix}.jsonl`);
    const initializedPath = path.join(temp, `initialized-${suffix}`);
    const child = spawnSync(process.execPath, [serverPath], {
      input: requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, CANIAGENT_MCP_RECEIPT_PATH: receiptPath,
        CANIAGENT_MCP_INITIALIZED_PATH: initializedPath,
        CANIAGENT_MCP_EXPECTED_TEXT: MCP_MARKER }
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim().split("\n").length, requests.length);
    assert.equal(readMcpInitialization(initializedPath), true);
    return readMcpReceipt(receiptPath);
  };
  try {
    const before = runSequence([call, initialize], "before");
    assert.deepEqual(before, [{ name: TOOL_NAME, matched: false }]);
    assert.equal(classifyMcpEvidence({ outcome: "success" }, before, true), "fail");
    const after = runSequence([initialize, call], "after");
    assert.deepEqual(after, [{ name: TOOL_NAME, matched: true }]);
    assert.equal(classifyMcpEvidence({ outcome: "success" }, after, true), "pass");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("MCP receipt parsing fails closed on invalid JSONL structure", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-invalid-receipt-"));
  const receiptPath = path.join(temp, "receipt.jsonl");
  const valid = JSON.stringify({ name: TOOL_NAME, matched: true });
  try {
    assert.deepEqual(readMcpReceipt(receiptPath), [], "missing receipt means no calls");
    for (const [name, content] of Object.entries({
      duplicateName: `{"name":null,"name":"${TOOL_NAME}","matched":true}`,
      duplicateMatched: `{"name":"${TOOL_NAME}","matched":false,"matched":true}`,
      reorderedFields: `{"matched":true,"name":"${TOOL_NAME}"}`,
      noncanonicalWhitespace: `{ "name":"${TOOL_NAME}","matched":true}`,
      extraField: JSON.stringify({ name: TOOL_NAME, matched: true, extra: "invalid" }),
      wrongType: JSON.stringify({ name: TOOL_NAME, matched: "true" }),
      impossibleMatch: JSON.stringify({ name: null, matched: true }),
      unknownName: JSON.stringify({ name: "other", matched: false }),
      missingField: JSON.stringify({ matched: true }),
      nullRecord: "null",
      arrayRecord: "[]",
      mixedRecords: valid + "\n" + JSON.stringify({ name: TOOL_NAME, matched: 1 }),
      blankLine: valid + "\n\n",
      invalidJson: "{invalid",
      oversized: "x".repeat(65537)
    })) {
      fs.writeFileSync(receiptPath, content);
      const parsed = readMcpReceipt(receiptPath);
      assert.equal(parsed, null, name);
      assert.equal(parsed === null ? "inconclusive" : classifyMcpResult({ outcome: "success" }, parsed),
        "inconclusive", name);
    }
    fs.writeFileSync(receiptPath, valid + "\n");
    assert.deepEqual(readMcpReceipt(receiptPath), [{ name: TOOL_NAME, matched: true }]);
    fs.writeFileSync(receiptPath, JSON.stringify({ name: null, matched: false }) + "\n" + valid + "\n");
    assert.equal(readMcpReceipt(receiptPath).length, 2, "rejected attempts remain countable");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("MCP evidence distinguishes absent handshake from a genuine zero-call result", () => {
  const success = { outcome: "success" };
  const valid = [{ name: TOOL_NAME, matched: true }];
  assert.equal(classifyMcpEvidence(success, [], false), "inconclusive");
  assert.equal(classifyMcpEvidence(success, [], true), "fail");
  assert.equal(classifyMcpEvidence(success, valid, true), "pass");
  assert.equal(classifyMcpEvidence(success, valid, false), "inconclusive");
  assert.equal(classifyMcpEvidence(success, null, true), "inconclusive");
  assert.equal(classifyMcpEvidence({ outcome: "not_found" }, [], false), "skip");
});

test("MCP server records initialization only after a protocol handshake", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-initialize-"));
  const markerPath = path.join(temp, "initialized");
  const serverPath = fileURLToPath(new URL("../scripts/mcp-echo-server.js", import.meta.url));
  const run = (request) => spawnSync(process.execPath, [serverPath], {
    input: JSON.stringify(request) + "\n", encoding: "utf8", timeout: 5000,
    env: { ...process.env, CANIAGENT_MCP_INITIALIZED_PATH: markerPath }
  });
  try {
    assert.equal(readMcpInitialization(markerPath), false);
    const list = run({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(list.status, 0, list.stderr);
    assert.equal(readMcpInitialization(markerPath), false, "listing is not initialization");
    const validParams = { protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "test", version: "1" } };
    for (const invalid of [
      { jsonrpc: "2.0", id: 3, method: "initialize" },
      { jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "initialize", params: validParams },
      { id: 3, method: "initialize", params: validParams }
    ]) {
      const rejected = run(invalid);
      assert.equal(rejected.status, 0, rejected.stderr);
      assert.equal(JSON.parse(rejected.stdout.trim()).error.code, -32600);
      assert.equal(readMcpInitialization(markerPath), false, "invalid initialize must not create evidence");
    }
    const initialized = run({ jsonrpc: "2.0", id: 2, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(JSON.parse(initialized.stdout.trim()).result.serverInfo.name, "caniagent-echo");
    assert.equal(readMcpInitialization(markerPath), true);
    fs.writeFileSync(markerPath, "corrupt");
    assert.equal(readMcpInitialization(markerPath), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

function scanCodexConfig(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-codex-toml-"));
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".codex", "config.toml"), content);
  return scanRepository(dir);
}

test("scanner ignores MCP-looking table headers inside TOML strings and comments", () => {
  const found = scanCodexConfig(`
message = "[mcp_servers.inline]"
literal = '[mcp_servers.literal]'
basic = """
[mcp_servers.multiline_basic]
"""
raw = '''
[mcp_servers.multiline_literal]
'''
# [mcp_servers.comment]
`);

  assert.deepEqual(found, []);
});

test("scanner still detects a structural Codex MCP table after strings", () => {
  const found = scanCodexConfig(`
message = "[mcp_servers.fake]"
[mcp_servers."real.server"] # quoted key and trailing comment
command = "example"
`);

  assert.deepEqual(found.map(({ path: file, feature, native }) => ({ path: file, feature, native })), [
    { path: ".codex/config.toml", feature: "mcp", native: ["codex"] }
  ]);
});

test("scanner ignores MCP-looking text in an unterminated TOML multiline string", () => {
  const found = scanCodexConfig(`
message = """
still string
[mcp_servers.not_structural]
`);

  assert.deepEqual(found, []);
});

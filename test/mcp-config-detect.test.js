import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-config-"));
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".gemini"), { recursive: true });
  return dir;
}

test("scanner recognizes documented MCP declarations in native project configs", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, ".codex", "config.toml"), '[mcp_servers.docs]\ncommand = "example"\n');
  fs.writeFileSync(path.join(dir, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { docs: { command: "example" } } }));
  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify({ mcp: { docs: { type: "local", command: ["example"] } } }));

  assert.deepEqual(scanRepository(dir).map(({ path: file, native }) => ({ path: file, native })), [
    { path: ".codex/config.toml", native: ["codex"] },
    { path: ".gemini/settings.json", native: ["gemini-cli"] },
    { path: "opencode.json", native: ["opencode"] }
  ]);
});

test("scanner does not classify general native config files as MCP", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, ".codex", "config.toml"), 'model = "example"\n');
  fs.writeFileSync(path.join(dir, ".gemini", "settings.json"), JSON.stringify({ theme: "default" }));
  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify({ model: "example" }));

  assert.deepEqual(scanRepository(dir), []);
});

test("scanner reports malformed native JSON configs instead of hiding possible MCP detections", () => {
  for (const [file, content] of [
    [".mcp.json", '{ "mcpServers":'],
    [".gemini/settings.json", '{ "mcpServers":'],
    ["opencode.json", '{ "mcp":']
  ]) {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, file), content);
    assert.throws(() => scanRepository(dir), (error) => {
      assert.equal(error.message, `Cannot parse scan config as JSON: ${file}`);
      return true;
    });
  }
});

test("scanner reports unreadable native configs instead of hiding MCP detections", (t) => {
  const dir = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = [".codex/config.toml", ".gemini/settings.json", "opencode.json"];
  for (const file of files) fs.writeFileSync(path.join(dir, file), "{}");
  const originalRead = fs.readFileSync;
  for (const file of files) {
    const blocked = path.join(dir, file);
    fs.readFileSync = (target, ...args) => {
      if (path.resolve(target) === blocked) {
        throw Object.assign(new Error("fixture-only diagnostic"), { code: "EACCES" });
      }
      return originalRead(target, ...args);
    };
    try {
      assert.throws(() => scanRepository(dir), (error) => {
        assert.equal(error.message, `Cannot read scan config: ${file} (EACCES)`);
        return true;
      });
    } finally {
      fs.readFileSync = originalRead;
    }
  }
});

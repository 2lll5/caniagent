import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-json-bom-"));
  fs.mkdirSync(path.join(dir, ".gemini"), { recursive: true });
  return dir;
}

test("scanner accepts UTF-8 BOM in native JSON and JSONC configs", (t) => {
  const cases = [
    [".mcp.json", JSON.stringify({ mcpServers: {} })],
    [".gemini/settings.json", JSON.stringify({ mcpServers: {} })],
    ["opencode.json", JSON.stringify({ mcp: {} })],
    ["opencode.jsonc", '{ // comment\n "mcp": {},\n}']
  ];

  for (const [file, content] of cases) {
    const dir = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, file), `\uFEFF${content}`);

    assert.deepEqual(scanRepository(dir).map((item) => item.path), [file]);
  }
});

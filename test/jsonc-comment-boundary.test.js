import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner does not merge JSON tokens across OpenCode block comments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-jsonc-boundary-"));
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), '{"mcp": 1/* comment */2}');

  assert.throws(
    () => scanRepository(dir),
    /Cannot parse scan config as JSONC: opencode\.jsonc/
  );
});

test("scanner still accepts block comments where JSON whitespace is valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-jsonc-comment-"));
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), '{"mcp"/* comment */: {}}');

  assert.deepEqual(scanRepository(dir).map((item) => item.path), ["opencode.jsonc"]);
});

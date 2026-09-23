import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner rejects an unterminated JSONC block comment after otherwise valid config", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-jsonc-comment-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), '{ "mcp": {} } /* unterminated');

  assert.throws(() => scanRepository(dir), (error) => {
    assert.equal(error.message, "Cannot parse scan config as JSONC: opencode.jsonc");
    return true;
  });
});

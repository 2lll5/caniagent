import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner ignores non-regular filesystem entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-special-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# project rules");

  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = (target, options) => {
    const entries = originalReaddirSync(target, options);
    if (path.resolve(target) !== path.resolve(dir)) return entries;
    return [
      {
        name: "config.toml",
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => false
      },
      ...entries
    ];
  };

  try {
    assert.deepEqual(scanRepository(dir, { maxFiles: 1 }).map((item) => item.path), ["AGENTS.md"]);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
});

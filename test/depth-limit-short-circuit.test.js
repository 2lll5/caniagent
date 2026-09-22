import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner stops traversing after the depth limit is exceeded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-depth-stop-"));
  const first = path.join(dir, "a-deep");
  const blocked = path.join(dir, "z-blocked");
  fs.mkdirSync(path.join(first, "too-deep"), { recursive: true });
  fs.mkdirSync(blocked);

  const originalReaddirSync = fs.readdirSync;
  let blockedRead = false;
  fs.readdirSync = (target, options) => {
    if (path.resolve(target) === path.resolve(blocked)) {
      blockedRead = true;
      throw new Error("scanner continued past depth limit");
    }
    const entries = originalReaddirSync(target, options);
    return Array.isArray(entries)
      ? entries.sort((a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b)))
      : entries;
  };

  try {
    assert.throws(
      () => scanRepository(dir, { maxDepth: 1 }),
      /Scan exceeded depth limit \(1\) before the repository was fully inspected/
    );
    assert.equal(blockedRead, false);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
});

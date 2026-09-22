import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner stops traversing after the file limit is exceeded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-limit-stop-"));
  const first = path.join(dir, "a-files");
  const blocked = path.join(dir, "z-blocked");
  fs.mkdirSync(first);
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(first, "one.txt"), "one");
  fs.writeFileSync(path.join(first, "two.txt"), "two");

  const originalReaddirSync = fs.readdirSync;
  let blockedRead = false;
  fs.readdirSync = (target, options) => {
    if (path.resolve(target) === path.resolve(blocked)) {
      blockedRead = true;
      throw new Error("scanner continued past file limit");
    }
    const entries = originalReaddirSync(target, options);
    return Array.isArray(entries)
      ? entries.sort((a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b)))
      : entries;
  };

  try {
    assert.throws(
      () => scanRepository(dir, { maxFiles: 1 }),
      /Scan exceeded file limit \(1\) before the repository was fully inspected/
    );
    assert.equal(blockedRead, false);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
});

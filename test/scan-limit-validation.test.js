import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

const invalidCases = [
  ["maxDepth", -1],
  ["maxDepth", 1.5],
  ["maxDepth", Number.NaN],
  ["maxDepth", Number.POSITIVE_INFINITY],
  ["maxDepth", Number.MAX_SAFE_INTEGER + 1],
  ["maxFiles", -1],
  ["maxFiles", 1.5],
  ["maxFiles", Number.NaN],
  ["maxFiles", Number.POSITIVE_INFINITY],
  ["maxFiles", Number.MAX_SAFE_INTEGER + 1]
];

for (const [name, value] of invalidCases) {
  test(`scanner rejects invalid ${name} value ${String(value)}`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-limit-validation-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.throws(
      () => scanRepository(dir, { [name]: value }),
      new RegExp(`${name} must be a non-negative integer`)
    );
  });
}

test("scanner accepts zero-valued limits", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-zero-limits-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(scanRepository(dir, { maxDepth: 0, maxFiles: 0 }), []);
});

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
  ["maxFiles", -1],
  ["maxFiles", 1.5],
  ["maxFiles", Number.NaN],
  ["maxFiles", Number.POSITIVE_INFINITY]
];

for (const [name, value] of invalidCases) {
  test(`scanner rejects invalid ${name} value ${String(value)}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-limit-validation-"));
    assert.throws(
      () => scanRepository(dir, { [name]: value }),
      new RegExp(`${name} must be a non-negative integer`)
    );
  });
}

test("scanner accepts zero-valued limits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-zero-limits-"));
  assert.deepEqual(scanRepository(dir, { maxDepth: 0, maxFiles: 0 }), []);
});

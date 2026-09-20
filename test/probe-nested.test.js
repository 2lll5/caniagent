import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NESTED_PROBE_SPECS, classifyNestedMarkers, createNestedInstructionFixture } from "../scripts/probe-nested.js";

for (const agentId of Object.keys(NESTED_PROBE_SPECS)) {
  test(`nested probe creates isolated root and nested instructions for ${agentId}`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-probe-test-"));
    try {
      const fixture = createNestedInstructionFixture(temp, agentId);
      const root = fs.readFileSync(path.join(fixture.workspace, fixture.file), "utf8");
      const nested = fs.readFileSync(path.join(fixture.nested, fixture.file), "utf8");
      assert.match(root, new RegExp(fixture.rootMarker));
      assert.match(nested, new RegExp(fixture.nestedMarker));
      assert.notEqual(fixture.rootMarker, fixture.nestedMarker);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}

test("nested marker classification distinguishes precedence observations", () => {
  const fixture = { rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER" };
  assert.deepEqual(classifyNestedMarkers("ROOT_MARKER NESTED_MARKER", fixture), {
    root: true,
    nested: true,
    verdict: "root-and-nested"
  });
  assert.equal(classifyNestedMarkers("ROOT_MARKER", fixture).verdict, "root-only");
  assert.equal(classifyNestedMarkers("NESTED_MARKER", fixture).verdict, "nested-only");
  assert.equal(classifyNestedMarkers("authentication required", fixture).verdict, "inconclusive");
});

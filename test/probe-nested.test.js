import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NESTED_PROBE_SPECS, classifyNestedEvidence, classifyNestedMarkers, createNestedInstructionFixture } from "../scripts/probe-nested.js";

test("Codex nested probe explicitly permits its generated non-Git fixture", () => {
  const prompt = "Return the applicable instruction markers";
  assert.deepEqual(NESTED_PROBE_SPECS.codex.args(prompt), [
    "exec", "--ephemeral", "--skip-git-repo-check", prompt
  ]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-codex-nongit-"));
  try {
    const fixture = createNestedInstructionFixture(temp, "codex");
    assert.equal(fs.existsSync(path.join(fixture.workspace, ".git")), false);
    assert.equal(fs.existsSync(path.join(fixture.nested, ".git")), false);
    assert.equal(fs.existsSync(path.join(fixture.nested, "AGENTS.md")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

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
      assert.deepEqual(NESTED_PROBE_SPECS[agentId].versionArgs, ["--version"]);
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

test("nested probe classifies raw stdout, not stderr diagnostics or truncated evidence", () => {
  const fixture = { rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER" };
  assert.equal(classifyNestedEvidence({
    outcome: "success", stdout: "NESTED_MARKER", stderr: "ROOT_MARKER"
  }, fixture).verdict, "nested-only");
  assert.equal(classifyNestedEvidence({
    outcome: "success", stdout: "no markers", stderr: "ROOT_MARKER"
  }, fixture).verdict, "inconclusive");
  assert.equal(classifyNestedEvidence({
    outcome: "success", stdout: "x".repeat(12001) + "ROOT_MARKER"
  }, fixture).verdict, "root-only");
  assert.deepEqual(classifyNestedEvidence({
    outcome: "nonzero_exit", stdout: "ROOT_MARKER NESTED_MARKER"
  }, fixture), { root: false, nested: false, verdict: "inconclusive" });
});

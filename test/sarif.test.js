import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadMatrix, getAgent } from "../src/core.js";
import { compatibilityFindings } from "../src/detect.js";
import { buildSarif } from "../src/sarif.js";

const matrix = loadMatrix();

test("SARIF emits migration attention for foreign conventions", () => {
  const detections = [
    { path: "CLAUDE.md", feature: "project-instructions", native: ["claude-code"], label: "CLAUDE.md" }
  ];
  const findings = compatibilityFindings(matrix, detections, "codex");
  const sarif = buildSarif({
    matrix,
    targetAgent: getAgent(matrix, "codex"),
    root: "/tmp/repo",
    findings
  });

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0].results.length, 1);
  assert.equal(sarif.runs[0].results[0].ruleId, "caniagent/project-instructions/foreign-convention");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "CLAUDE.md");
});

test("SARIF source root is a portable absolute file URI", () => {
  const root = path.resolve("test", "fixtures", "repo with spaces");
  const sarif = buildSarif({
    matrix,
    targetAgent: getAgent(matrix, "codex"),
    root,
    findings: []
  });
  const uri = sarif.runs[0].originalUriBaseIds["%SRCROOT%"].uri;
  const parsed = new URL(uri);

  assert.equal(parsed.protocol, "file:");
  assert.ok(parsed.pathname.endsWith("/repo%20with%20spaces/"));
  assert.ok(uri.endsWith("/"));
});

test("SARIF emits support notes for partial or unknown cells", () => {
  const detections = [
    { path: "AGENTS.md", feature: "sandbox", native: ["opencode"], label: "fixture" }
  ];
  const findings = compatibilityFindings(matrix, detections, "opencode");
  const sarif = buildSarif({
    matrix,
    targetAgent: getAgent(matrix, "opencode"),
    root: "/tmp/repo",
    findings
  });
  assert.ok(sarif.runs[0].results.some((result) => result.ruleId === "caniagent/sandbox/support-partial"));
});

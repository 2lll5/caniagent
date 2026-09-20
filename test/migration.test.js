import test from "node:test";
import assert from "node:assert/strict";
import { migrationDetections, migrationSuggestions } from "../src/migration.js";

test("filters detections to conventions native to the source agent", () => {
  const detections = [
    { path: "CLAUDE.md", native: ["claude-code"] },
    { path: "AGENTS.md", native: ["codex", "opencode"] },
    { path: ".claude/skills/demo/SKILL.md", native: ["claude-code", "opencode"] }
  ];

  assert.deepEqual(
    migrationDetections(detections, "claude-code").map((item) => item.path),
    ["CLAUDE.md", ".claude/skills/demo/SKILL.md"]
  );
});

test("leaves detections unchanged when no source agent is requested", () => {
  const detections = [{ path: "AGENTS.md", native: ["codex"] }];
  assert.equal(migrationDetections(detections), detections);
});

test("suggests instruction filenames only when target support is evidence-backed", () => {
  const matrix = {
    agents: [
      { id: "codex", instructions: ["AGENTS.md"] },
      { id: "claude-code", instructions: ["CLAUDE.md"] }
    ],
    features: [{
      id: "project-instructions",
      support: {
        codex: { status: "yes", note: "Uses AGENTS.md", evidence: [{ url: "https://example.test/codex" }] }
      }
    }]
  };
  const detections = [
    { path: "CLAUDE.md", feature: "project-instructions", native: ["claude-code"] },
    { path: "packages/api/CLAUDE.md", feature: "nested-instructions", native: ["claude-code"] },
    { path: ".claude/skills/demo/SKILL.md", feature: "skills", native: ["claude-code"] }
  ];

  assert.deepEqual(
    migrationSuggestions(matrix, detections, "claude-code", "codex").map(({ from, to }) => ({ from, to })),
    [
      { from: "CLAUDE.md", to: "AGENTS.md" },
      { from: "packages/api/CLAUDE.md", to: "packages/api/AGENTS.md" }
    ]
  );
  assert.deepEqual(migrationSuggestions(matrix, detections, "claude-code", "claude-code"), []);
});

test("does not suggest translations for unverified target instruction support", () => {
  const matrix = {
    agents: [{ id: "target", instructions: ["TARGET.md"] }],
    features: [{ id: "project-instructions", support: { target: { status: "unknown", evidence: [] } } }]
  };
  const detections = [{ path: "SOURCE.md", feature: "project-instructions", native: ["source"] }];
  assert.deepEqual(migrationSuggestions(matrix, detections, "source", "target"), []);
});

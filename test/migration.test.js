import test from "node:test";
import assert from "node:assert/strict";
import { migrationDetections } from "../src/migration.js";

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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMatrix } from "../src/core.js";
import { scanRepository, compatibilityFindings } from "../src/detect.js";

function makeSkill(root, convention) {
  const dir = path.join(root, convention, "skills", "ship");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: ship\ndescription: test fixture\n---\n");
}

test("skill native agents follow the documented discovery path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-paths-"));
  makeSkill(dir, ".agents");
  makeSkill(dir, ".claude");
  makeSkill(dir, ".gemini");
  makeSkill(dir, ".opencode");

  const detections = scanRepository(dir);
  const byPath = new Map(detections.map((item) => [item.path, item.native]));

  assert.deepEqual(byPath.get(".agents/skills/ship/SKILL.md"), ["codex", "gemini-cli", "opencode"]);
  assert.deepEqual(byPath.get(".claude/skills/ship/SKILL.md"), ["claude-code", "opencode"]);
  assert.deepEqual(byPath.get(".gemini/skills/ship/SKILL.md"), ["gemini-cli"]);
  assert.deepEqual(byPath.get(".opencode/skills/ship/SKILL.md"), ["opencode"]);

  const matrix = loadMatrix();
  const codex = compatibilityFindings(matrix, detections, "codex").find((item) => item.featureId === "skills");
  assert.equal(codex.nativeCount, 1);
  assert.deepEqual(codex.foreign, [
    ".claude/skills/ship/SKILL.md",
    ".gemini/skills/ship/SKILL.md",
    ".opencode/skills/ship/SKILL.md"
  ]);

  const gemini = compatibilityFindings(matrix, detections, "gemini-cli").find((item) => item.featureId === "skills");
  assert.equal(gemini.nativeCount, 2);
  assert.deepEqual(gemini.foreign, [
    ".claude/skills/ship/SKILL.md",
    ".opencode/skills/ship/SKILL.md"
  ]);

  const opencode = compatibilityFindings(matrix, detections, "opencode").find((item) => item.featureId === "skills");
  assert.equal(opencode.nativeCount, 3);
  assert.deepEqual(opencode.foreign, [".gemini/skills/ship/SKILL.md"]);
});

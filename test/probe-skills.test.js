import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_PROBE_SPECS, classifySkillOutput, createSkillFixture } from "../scripts/probe-skills.js";

test("skill probe adapters use documented project discovery conventions", () => {
  assert.deepEqual(SKILL_PROBE_SPECS.codex.projectPath, [".agents", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["claude-code"].projectPath, [".claude", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS.opencode.projectPath, [".opencode", "skills"]);
  assert.equal(SKILL_PROBE_SPECS["gemini-cli"], undefined);
});

test("skill fixture contains a deterministic marker only inside SKILL.md", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-probe-test-"));
  try {
    const fixture = createSkillFixture(temp, "codex");
    assert.equal(fixture.discoveryPath, `.agents/skills/${fixture.skillName}/`);
    const skill = fs.readFileSync(path.join(fixture.skillDir, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(fixture.marker));
    assert.doesNotMatch(fs.readFileSync(path.join(fixture.workspace, "README.md"), "utf8"), new RegExp(fixture.marker));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("skill output classification never turns missing evidence into unsupported", () => {
  assert.deepEqual(classifySkillOutput("prefix CANIAGENT_SKILL_CODEX suffix", "CANIAGENT_SKILL_CODEX"), { discovered: true, verdict: "pass" });
  assert.deepEqual(classifySkillOutput("no marker", "CANIAGENT_SKILL_CODEX"), { discovered: false, verdict: "inconclusive" });
  assert.deepEqual(classifySkillOutput("CANIAGENT_SKILL_CODEX", "CANIAGENT_SKILL_CODEX", "error"), { discovered: false, verdict: "inconclusive" });
});

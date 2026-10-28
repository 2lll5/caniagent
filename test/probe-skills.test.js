import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_PROBE_SPECS, classifySkillOutput, createSkillFixture } from "../scripts/probe-skills.js";
import { isolatedProbeEnvironment } from "../scripts/probe-env.js";

test("skill probe adapters use documented project discovery conventions", () => {
  assert.deepEqual(SKILL_PROBE_SPECS.codex.projectPath, [".agents", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["claude-code"].projectPath, [".claude", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["gemini-cli"].projectPath, [".gemini", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS.opencode.projectPath, [".opencode", "skills"]);
});

test("skill probe adapters only encode documented isolated user discovery conventions", () => {
  assert.deepEqual(SKILL_PROBE_SPECS.codex.userPath, [".agents", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["claude-code"].userPath, [".claude", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["gemini-cli"].userPath, [".gemini", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS.opencode.userPath, [".config", "opencode", "skills"]);
});

test("Gemini skill probe auto-approves activation in non-interactive mode", () => {
  assert.deepEqual(SKILL_PROBE_SPECS["gemini-cli"].args("probe"), ["--approval-mode=yolo", "-p", "probe"]);
});

test("project skill fixture contains a deterministic marker only inside SKILL.md", () => {
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

test("user skill fixture stays inside the isolated home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-user-probe-test-"));
  try {
    const fixture = createSkillFixture(temp, "opencode", "user");
    assert.equal(fixture.discoveryPath, `~/.config/opencode/skills/${fixture.skillName}/`);
    assert.equal(path.relative(path.join(temp, "home"), fixture.skillDir).startsWith(".."), false);
    assert.equal(fs.existsSync(path.join(fixture.skillDir, "SKILL.md")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Gemini user skill fixture stays inside the isolated home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-gemini-skill-user-probe-test-"));
  try {
    const fixture = createSkillFixture(temp, "gemini-cli", "user");
    assert.equal(fixture.discoveryPath, `~/.gemini/skills/${fixture.skillName}/`);
    assert.equal(path.relative(path.join(temp, "home"), fixture.skillDir).startsWith(".."), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Claude Code personal skill fixture uses only the isolated config home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-claude-personal-skill-test-"));
  try {
    const fixture = createSkillFixture(temp, "claude-code", "user");
    const env = isolatedProbeEnvironment(path.join(temp, "home"), {
      HOME: "/outside/home",
      CLAUDE_CONFIG_DIR: "/outside/claude"
    });
    assert.equal(fixture.discoveryPath, `~/.claude/skills/${fixture.skillName}/`);
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(temp, "home", ".claude"));
    assert.equal(path.relative(env.CLAUDE_CONFIG_DIR, fixture.skillDir), path.join("skills", fixture.skillName));
    assert.equal(fs.existsSync(path.join(fixture.skillDir, "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(fixture.workspace, ".claude", "skills", fixture.skillName, "SKILL.md")), false);
    assert.match(fs.readFileSync(path.join(fixture.skillDir, "SKILL.md"), "utf8"), new RegExp(fixture.marker));
    assert.doesNotMatch(fs.readFileSync(path.join(fixture.workspace, "README.md"), "utf8"), new RegExp(fixture.marker));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("undocumented skill scope is rejected instead of guessed", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-unknown-scope-test-"));
  try {
    assert.throws(() => createSkillFixture(temp, "claude-code", "system"), /No system-scope Agent Skills discovery path/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("skill output classification never turns missing evidence into unsupported", () => {
  assert.deepEqual(classifySkillOutput("prefix CANIAGENT_SKILL_CODEX_PROJECT suffix", "CANIAGENT_SKILL_CODEX_PROJECT"), { discovered: true, verdict: "pass" });
  assert.deepEqual(classifySkillOutput("no marker", "CANIAGENT_SKILL_CODEX_PROJECT"), { discovered: false, verdict: "inconclusive" });
  assert.deepEqual(classifySkillOutput("CANIAGENT_SKILL_CODEX_PROJECT", "CANIAGENT_SKILL_CODEX_PROJECT", "error"), { discovered: false, verdict: "inconclusive" });
});

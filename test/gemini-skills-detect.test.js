import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

function withSkillPath(parts, assertion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-gemini-skills-"));
  try {
    const skillDir = path.join(dir, ...parts, "example");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: example\ndescription: fixture\n---\n");
    assertion(scanRepository(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("scanner recognizes Gemini-native workspace skills", () => {
  withSkillPath([".gemini", "skills"], (found) => {
    assert.deepEqual(found, [{
      path: ".gemini/skills/example/SKILL.md",
      feature: "skills",
      native: ["gemini-cli"],
      label: "SKILL.md"
    }]);
  });
});

test("shared .agents skill path is native to Gemini as documented", () => {
  withSkillPath([".agents", "skills"], (found) => {
    assert.deepEqual(found[0].native, ["codex", "gemini-cli", "opencode"]);
  });
});

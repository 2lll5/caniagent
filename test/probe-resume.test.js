import test from "node:test";
import assert from "node:assert/strict";
import { RESUME_SPECS, classifyResume } from "../scripts/probe-resume.js";

test("resume adapters encode documented non-interactive continuation modes", () => {
  assert.deepEqual(RESUME_SPECS.codex.resumeArgs("next"), ["exec", "resume", "--last", "next"]);
  assert.deepEqual(RESUME_SPECS["claude-code"].resumeArgs("next"), ["-p", "--continue", "next"]);
  assert.deepEqual(RESUME_SPECS["gemini-cli"].resumeArgs("next"), ["-r", "latest", "next"]);
  assert.deepEqual(RESUME_SPECS.opencode.resumeArgs("next"), ["run", "--continue", "next"]);
});

test("resume passes only when a successful second turn recalls the first-turn marker", () => {
  assert.deepEqual(classifyResume("success", "success", "CANIAGENT_RESUME_CODEX", "CANIAGENT_RESUME_CODEX"), {
    markerObserved: true,
    verdict: "pass"
  });
  assert.deepEqual(classifyResume("success", "success", "I do not know", "CANIAGENT_RESUME_CODEX"), {
    markerObserved: false,
    verdict: "fail"
  });
});

test("runtime and authentication failures remain inconclusive", () => {
  assert.deepEqual(classifyResume("error", "not-run", "", "MARKER"), {
    markerObserved: false,
    verdict: "inconclusive"
  });
  assert.deepEqual(classifyResume("success", "error", "MARKER", "MARKER"), {
    markerObserved: false,
    verdict: "inconclusive"
  });
});

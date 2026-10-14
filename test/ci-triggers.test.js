import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("CI runs on pull requests and explicit manual dispatch, not main pushes", () => {
  const triggers = ci.match(/^on:\n([\s\S]*?)(?=^permissions:)/m)?.[1];
  assert.ok(triggers, "CI event section must exist");
  const events = [...triggers.matchAll(/^  ([a-z_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(events, ["pull_request", "workflow_dispatch"]);
});

test("CI retains the existing Node, OS, package and SARIF checks", () => {
  assert.match(ci, /node: \[20, 22, 24\]/);
  assert.match(ci, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /npm run check/);
  assert.match(ci, /SARIF smoke test/);
  assert.match(ci, /npm pack --json/);
  assert.match(ci, /Check threshold failure preserves SARIF/);
});

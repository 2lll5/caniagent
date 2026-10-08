import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");

// Keep release publishing opt-in. CI for PRs is handled by ci.yml.
test("release workflow runs only when manually dispatched with an explicit tag", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      tag:/m);
  assert.match(workflow, /^        required: true$/m);
  const triggers = workflow.slice(workflow.indexOf("on:\n"), workflow.indexOf("\npermissions:\n"));
  assert.doesNotMatch(triggers, /^  (push|pull_request|schedule|release):/m);
  assert.match(workflow, /group: caniagent-release-\$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("release requires an existing main-reachable tag and checks the tagged source before publishing", () => {
  assert.match(workflow, /RELEASE_TAG: \$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /\$GITHUB_REF" != "refs\/heads\/main"/);
  assert.match(workflow, /git fetch --no-tags origin "refs\/tags\/\$RELEASE_TAG:refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$tag_commit" refs\/remotes\/origin\/main/);
  assert.match(workflow, /git checkout --detach "\$tag_commit"/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /gh release create "\$RELEASE_TAG"[^\n]*--verify-tag/);
  assert.doesNotMatch(workflow, /gh release create[^\n]*--target/);
  assert.doesNotMatch(workflow, /git (?:tag|push)\s/);
  assert.ok(workflow.indexOf("npm run check") < workflow.indexOf("gh release create"));
});

test("release version guard rejects mismatched package and lockfile versions", (t) => {
  const code = workflow.match(/          node -e '([^'\n]+)'/)?.[1];
  assert.ok(code, "release workflow must include a version guard");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (tag, packageVersion, lockVersion, rootVersion) => {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: packageVersion }));
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ version: lockVersion, packages: { "": { version: rootVersion } } }));
    return spawnSync(process.execPath, ["-e", code], { cwd: root, env: { ...process.env, RELEASE_TAG: tag }, encoding: "utf8" });
  };
  assert.equal(run("v0.4.0", "0.4.0", "0.4.0", "0.4.0").status, 0);
  for (const versions of [
    ["v0.4.0", "0.4.1", "0.4.0", "0.4.0"],
    ["v0.4.0", "0.4.0", "0.3.0", "0.4.0"],
    ["v0.4.0", "0.4.0", "0.4.0", "0.3.0"],
  ]) {
    const result = run(...versions);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /versions must match/);
  }
});

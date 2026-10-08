import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const verifyBlock = workflow.match(/      - name: Verify existing release tag\n[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name: Validate tagged source)/)?.[1];
assert.ok(verifyBlock, "Release tag verification script must exist");
const verifyScript = verifyBlock.split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");

function command(cwd, cmd, args, env = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function git(cwd, ...args) {
  const r = command(cwd, "git", args);
  assert.equal(r.status, 0, args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}

test("release guard checks real tag ancestry, existence, format, and version", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-release-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin.git");
  const author = path.join(root, "author");
  const checkout = path.join(root, "checkout");
  fs.mkdirSync(author);
  git(root, "init", "--bare", origin);
  git(author, "init", "-b", "main");
  git(author, "config", "user.email", "test@example.invalid");
  git(author, "config", "user.name", "Test");
  assert.equal(git(author, "branch", "--show-current"), "main");
  git(author, "remote", "add", "origin", origin);
  const writeVersions = (version) => {
    fs.writeFileSync(path.join(author, "package.json"), JSON.stringify({ version }));
    fs.writeFileSync(path.join(author, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
  };
  writeVersions("0.4.0");
  git(author, "add", ".");
  git(author, "commit", "-m", "version 0.4.0");
  git(author, "tag", "v0.4.0");
  git(author, "push", "-u", "origin", "main", "v0.4.0");
  git(root, "clone", "-b", "main", origin, checkout);
  const run = (tag) => command(checkout, "bash", ["-e", "-o", "pipefail", "-c", verifyScript], { RELEASE_TAG: tag, GITHUB_REF: "refs/heads/main" });
  assert.equal(run("v0.4.0").status, 0, "valid main-reachable version tag should pass");
  const wrongRef = command(checkout, "bash", ["-e", "-o", "pipefail", "-c", verifyScript], { RELEASE_TAG: "v0.4.0", GITHUB_REF: "refs/heads/feature" });
  assert.notEqual(wrongRef.status, 0, "manual dispatch from a non-main ref should fail");
  assert.match(wrongRef.stderr, /dispatched from main/);
  assert.notEqual(run("not-a-version").status, 0, "invalid tag format should fail");
  assert.notEqual(run("v9.9.9").status, 0, "missing tag should fail");
  git(author, "checkout", "-b", "unmerged");
  writeVersions("0.5.0");
  git(author, "add", ".");
  git(author, "commit", "-m", "unmerged release");
  git(author, "tag", "v0.5.0");
  git(author, "push", "origin", "v0.5.0");
  const unmerged = run("v0.5.0");
  assert.notEqual(unmerged.status, 0, "tag not reachable from main should fail");
  assert.match(unmerged.stderr, /reachable from main/);
});

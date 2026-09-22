import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); }

test("check --from reports only source-native surfaces and evidence-backed translations", () => {
  const root = mkdtempSync(join(tmpdir(), "caniagent-migration-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "# source instructions\n");
    writeFileSync(join(root, "AGENTS.md"), "# unrelated target instructions\n");
    mkdirSync(join(root, "packages", "api"), { recursive: true });
    writeFileSync(join(root, "packages", "api", "CLAUDE.md"), "# nested source instructions\n");
    mkdirSync(join(root, ".claude", "skills", "demo"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");

    const result = run(["check", root, "--from", "claude-code", "--agent", "codex", "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.source.id, "claude-code");
    assert.equal(report.target.id, "codex");
    assert.deepEqual(report.detections.map((item) => item.path), [".claude/skills/demo/SKILL.md", "CLAUDE.md", "packages/api/CLAUDE.md"]);
    assert.equal(report.detections.some((item) => item.path === "AGENTS.md"), false);
    assert.deepEqual(report.suggestions.map(({ from, to }) => ({ from, to })), [
      { from: "CLAUDE.md", to: "AGENTS.md" },
      { from: "packages/api/CLAUDE.md", to: "packages/api/AGENTS.md" }
    ]);
    assert.equal(report.suggestions[0].evidence.status, "yes");
    assert.ok(report.suggestions[0].evidence.urls.length > 0);

    const text = run(["check", root, "--from", "claude-code", "--agent", "codex"]);
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /Suggested file translations:/);
    assert.match(text.stdout, /CLAUDE\.md → AGENTS\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project-scoped instruction files migrate to the target project root", () => {
  const root = mkdtempSync(join(tmpdir(), "caniagent-project-scope-"));
  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "CLAUDE.md"), "# project instructions\n");

    const result = run(["check", root, "--from", "claude-code", "--agent", "codex", "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.suggestions.map(({ from, to }) => ({ from, to })), [
      { from: ".claude/CLAUDE.md", to: "AGENTS.md" }
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check --from rejects unknown and identical source agents", () => {
  const unknown = run(["check", ".", "--from", "missing", "--agent", "codex"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown source agent: missing/);

  const same = run(["check", ".", "--from", "codex", "--agent", "codex"]);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /--from must differ from --agent/);
});

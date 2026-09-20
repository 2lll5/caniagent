import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); }

test("check --from reports only source-native surfaces", () => {
  const root = mkdtempSync(join(tmpdir(), "caniagent-migration-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "# source instructions\n");
    writeFileSync(join(root, "AGENTS.md"), "# unrelated target instructions\n");
    mkdirSync(join(root, ".claude", "skills", "demo"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");

    const result = run(["check", root, "--from", "claude-code", "--agent", "codex", "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.source.id, "claude-code");
    assert.equal(report.target.id, "codex");
    assert.deepEqual(report.detections.map((item) => item.path), [".claude/skills/demo/SKILL.md", "CLAUDE.md"]);
    assert.equal(report.detections.some((item) => item.path === "AGENTS.md"), false);
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

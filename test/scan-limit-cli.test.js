import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function check(root, option, value) {
  return spawnSync(process.execPath, [cli, "check", root, "--agent", "codex", "--format", "json", option, value], {
    encoding: "utf8"
  });
}

test("CLI accepts explicit scan limits and preserves JSON output", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-cli-limits-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# fixture\n");

  for (const [option, value] of [["--max-depth", "0"], ["--max-depth", "1"], ["--max-files", "1"], ["--max-files", "20"]]) {
    const result = check(root, option, value);
    assert.equal(result.status, 0, `${option}=${value}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout).detections.map((item) => item.path), ["AGENTS.md"]);
  }
});

test("CLI rejects scan limits that are not canonical safe integers", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-cli-bad-limits-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const option of ["--max-depth", "--max-files"]) {
    for (const value of ["1.5", "01", "1e3", "9007199254740992", "Infinity", "+1"]) {
      const result = check(root, option, value);
      assert.equal(result.status, 1, `${option}=${value}`);
      assert.match(result.stderr, /must be a non-negative safe integer/);
      assert.equal(result.stdout, "");
    }
  }
});

test("CLI refuses incomplete scans instead of emitting misleading reports", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-cli-incomplete-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# fixture\n");

  const result = check(root, "--max-files", "0");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Scan exceeded file limit \(0\)/);
  assert.equal(result.stdout, "");
});

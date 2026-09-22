import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const action = fs.readFileSync(new URL("../action.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const scan = action.match(/    - id: scan[\s\S]*?      run: \|\n([\s\S]*?)(?=\n    - name: Upload SARIF)/)[1];
const actionPath = fileURLToPath(new URL("..", import.meta.url));

// The composite's native Windows execution is covered by the action-smoke job.
test("Action keeps separate reports across invocations and preserves threshold failures for enforcement", { skip: process.platform === "win32" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-action-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo with spaces");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "# source fixture\n");
  const output = path.join(root, "outputs");
  const env = {
    ...process.env, GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: output,
    CANIAGENT_TEMP: root, CANIAGENT_PATH: repo, CANIAGENT_AGENT: "codex",
    CANIAGENT_FROM: "claude-code", CANIAGENT_FAIL_ON: "warning"
  };
  const invoke = () => {
    fs.writeFileSync(output, "");
    const execution = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", scan], { env, encoding: "utf8" });
    const outputs = Object.fromEntries(fs.readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }));
    return { execution, outputs };
  };
  const first = invoke();
  assert.equal(first.execution.status, 0, first.execution.stderr);
  assert.equal(first.outputs["exit-code"], "2");
  const firstReport = fs.readFileSync(first.outputs.sarif, "utf8");
  assert.equal(JSON.parse(firstReport).runs[0].results[0].level, "warning");

  env.CANIAGENT_FAIL_ON = "none";
  const second = invoke();
  assert.equal(second.execution.status, 0, second.execution.stderr);
  assert.equal(second.outputs["exit-code"], "0");
  assert.notEqual(first.outputs.sarif, second.outputs.sarif);
  assert.equal(fs.readFileSync(first.outputs.sarif, "utf8"), firstReport);

  env.CANIAGENT_PATH = path.join(root, "missing");
  const invalid = invoke();
  assert.equal(invalid.execution.status, 1);
  assert.deepEqual(invalid.outputs, {});

  env.CANIAGENT_PATH = "--help";
  const noReport = invoke();
  assert.equal(noReport.execution.status, 1);
  assert.deepEqual(noReport.outputs, {});
  assert.match(noReport.execution.stderr, /scan did not produce a SARIF report/);
});

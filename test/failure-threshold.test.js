import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const run = (args, executable = cli) => spawnSync(process.execPath, [executable, ...args], { encoding: "utf8" });

function fixture(t, name = "CLAUDE.md") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-threshold-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, name), "# instruction fixture\n");
  return root;
}

test("failure thresholds keep the default advisory behavior and distinguish warning severity", (t) => {
  const root = fixture(t);
  for (const args of [[], ["--fail-on", "none"], ["--fail-on", "error"]]) {
    const result = run(["check", root, "--agent", "codex", "--json", ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).findings[0].foreign, ["CLAUDE.md"]);
  }
  for (const format of ["text", "json", "sarif"]) {
    const result = run(["check", root, "--agent", "codex", "--format", format, "--fail-on", "warning"]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /compatibility findings meet --fail-on warning/);
    if (format !== "text") assert.doesNotThrow(() => JSON.parse(result.stdout));
    else assert.match(result.stdout, /migration attention/);
  }
});

test("threshold failures still write a complete SARIF report", (t) => {
  const root = fixture(t);
  const output = path.join(root, "reports", "scan.sarif");
  const result = run(["check", root, "--agent", "codex", "--format", "sarif", "--output", output, "--fail-on", "warning"]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.version, "2.1.0");
  assert.equal(report.runs[0].results[0].level, "warning");
});

test("native conventions and unknown support notes do not fail a warning threshold", (t) => {
  const root = fixture(t, "AGENTS.md");
  assert.equal(run(["check", root, "--agent", "codex", "--fail-on", "warning"]).status, 0);
  fs.rmSync(path.join(root, "AGENTS.md"));
  fs.mkdirSync(path.join(root, ".gemini", "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gemini", "skills", "demo", "SKILL.md"), "# skill fixture\n");
  const result = run(["check", root, "--agent", "gemini-cli", "--format", "sarif", "--fail-on", "warning"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).runs[0].results.every((item) => item.level === "note"));
});

test("documented no support fails both error and warning thresholds", (t) => {
  const root = fixture(t);
  const installation = path.join(root, "installation");
  fs.cpSync(new URL("../src", import.meta.url), path.join(installation, "src"), { recursive: true });
  fs.copyFileSync(new URL("../package.json", import.meta.url), path.join(installation, "package.json"));
  const matrix = JSON.parse(fs.readFileSync(new URL("../data/matrix.json", import.meta.url), "utf8"));
  matrix.features.find((item) => item.id === "project-instructions").support.codex.status = "no";
  fs.mkdirSync(path.join(installation, "data"));
  fs.writeFileSync(path.join(installation, "data", "matrix.json"), JSON.stringify(matrix));
  for (const threshold of ["warning", "error"]) {
    const result = run(["check", root, "--agent", "codex", "--format", "sarif", "--fail-on", threshold], path.join(installation, "src", "cli.js"));
    assert.equal(result.status, 2, result.stderr);
    assert.ok(JSON.parse(result.stdout).runs[0].results.some((item) => item.level === "error"));
  }
});

test("invalid output options fail before scanning and never produce a report", (t) => {
  const root = fixture(t);
  const missing = path.join(root, "missing");
  for (const [args, message] of [
    [["--fail-on", "warn"], /Unsupported failure threshold/],
    [["--fail-on"], /--fail-on requires a value/],
    [["--format", "yaml"], /Unsupported format/],
    [["--output", ""], /--output requires a value/]
  ]) {
    const result = run(["check", missing, "--agent", "codex", ...args]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
  }
  const result = run(["check", missing, "--agent", "codex", "--fail-on", "none"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Scan path does not exist/);
});

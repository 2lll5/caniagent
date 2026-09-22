import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packageVersion } from "../src/core.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("reports the package version", () => {
  const result = run(["--version"]);

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageVersion);
});

test("rejects an option whose value is another option", () => {
  const result = run(["check", ".", "--agent", "--format", "json"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: --agent requires a value/);
});

test("rejects an option with no following value", () => {
  const result = run(["check", ".", "--agent", "codex", "--output"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: --output requires a value/);
});

test("rejects unknown options instead of silently ignoring typos", () => {
  const result = run(["check", ".", "--agent", "codex", "--formt", "json"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: Unknown option: --formt/);
});

test("rejects duplicate options instead of silently using the first value", () => {
  const result = run(["check", ".", "--agent", "codex", "--agent", "claude-code"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: Duplicate option: --agent/);
});

test("rejects options for commands that do not accept any", () => {
  const result = run(["agents", "--json"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: Unknown option: --json/);
});

test("rejects unexpected positional arguments", () => {
  const result = run(["check", ".", "extra", "--agent", "codex"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: Unexpected argument: extra/);
});

test("rejects positional arguments for commands that accept none", () => {
  const result = run(["agents", "extra"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: Unexpected argument: extra/);
});

test("rejects conflicting check output format flags", () => {
  const result = run(["check", ".", "--agent", "codex", "--json", "--format", "sarif"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: --json cannot be combined with --format/);
});

test("still accepts valid valued options", () => {
  const result = run(["matrix", "--search", "sandbox", "--json"]);

  assert.equal(result.status, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});

test("help and version flags cannot turn missing option values into successful checks", () => {
  for (const args of [
    ["check", ".", "--agent", "--help"],
    ["matrix", "--search", "--version"],
    ["check", ".", "--agent", "codex", "--fail-on", "--version"]
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
  const help = run(["check", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
});

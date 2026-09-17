import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

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

test("rejects options for commands that do not accept any", () => {
  const result = run(["agents", "--json"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /caniagent: Unknown option: --json/);
});

test("still accepts valid valued options", () => {
  const result = run(["matrix", "--search", "sandbox", "--json"]);

  assert.equal(result.status, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
});

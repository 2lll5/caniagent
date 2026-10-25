import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isolatedProbeEnvironment } from "../scripts/probe-env.js";

const overrides = {
  HOME: (home) => home,
  USERPROFILE: (home) => home,
  CODEX_HOME: (home) => path.join(home, ".codex"),
  CLAUDE_CONFIG_DIR: (home) => path.join(home, ".claude"),
  APPDATA: (home) => path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: (home) => path.join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: (home) => path.join(home, ".config"),
  XDG_DATA_HOME: (home) => path.join(home, ".local", "share"),
  XDG_STATE_HOME: (home) => path.join(home, ".local", "state"),
  XDG_CACHE_HOME: (home) => path.join(home, ".cache")
};

test("behavior probe isolates inherited vendor, Windows, and XDG config homes", () => {
  const home = path.join(os.tmpdir(), "caniagent-probe-env with spaces");
  const inherited = Object.freeze(Object.fromEntries([
    ...Object.keys(overrides).map((key) => [key, `/outside/${key}`]),
    ["CANIAGENT_SENTINEL", "preserve-me"]
  ]));
  const env = isolatedProbeEnvironment(home, inherited);
  for (const [key, expected] of Object.entries(overrides)) {
    assert.equal(env[key], expected(home), key);
    assert.equal(inherited[key], `/outside/${key}`, `mutated ${key}`);
  }
  assert.equal(env.CANIAGENT_SENTINEL, "preserve-me");
});

test("behavior probe child process receives only temporary config paths", () => {
  const home = path.join(os.tmpdir(), "caniagent-probe-child with spaces");
  const inherited = Object.freeze(Object.fromEntries([
    ...Object.keys(overrides).map((key) => [key, `/outside/${key}`]),
    ["CANIAGENT_SENTINEL", "preserve-me"]
  ]));
  const env = isolatedProbeEnvironment(home, inherited);
  const child = spawnSync(process.execPath, [
    "-e",
    `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...Object.keys(overrides), "CANIAGENT_SENTINEL"])}.map(k=>[k,process.env[k]]))))`
  ], { env, encoding: "utf8", timeout: 5000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  for (const [key, expected] of Object.entries(overrides)) assert.equal(observed[key], expected(home), key);
  assert.equal(observed.CANIAGENT_SENTINEL, "preserve-me");
});

test("behavior probe handles an empty inherited environment", () => {
  const home = path.join(os.tmpdir(), "caniagent-probe-empty");
  const env = isolatedProbeEnvironment(home, Object.freeze({}));
  assert.deepEqual(Object.keys(env).sort(), Object.keys(overrides).sort());
  assert.equal(env.CODEX_HOME, path.join(home, ".codex"));
});

for (const name of ["probe-nested", "probe-skills", "probe-structured-output", "probe-resume"]) {
  test(`${name} uses shared isolated environment for subprocesses`, () => {
    const source = fs.readFileSync(new URL(`../scripts/${name}.js`, import.meta.url), "utf8");
    assert.match(source, /import \{ isolatedProbeEnvironment \} from "\.\/probe-env\.js";/);
    assert.match(source, /const env = isolatedProbeEnvironment\(home\);/);
    assert.doesNotMatch(source, /function isolatedEnvironment\(/);
  });
}

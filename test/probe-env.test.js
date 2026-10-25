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

for (const name of ["probe-nested", "probe-skills", "probe-structured-output", "probe-resume", "probe-mcp"]) {
  test(`${name} uses shared isolated environment for subprocesses`, () => {
    const source = fs.readFileSync(new URL(`../scripts/${name}.js`, import.meta.url), "utf8");
    assert.match(source, /import \{ isolatedProbeEnvironment \} from "\.\/probe-env\.js";/);
    assert.match(source, /const env = isolatedProbeEnvironment\(home\);/);
    assert.doesNotMatch(source, /function isolatedEnvironment\(/);
  });
}

test("behavior probe strips inherited NODE_OPTIONS, including mixed-case keys", () => {
  const inherited = Object.freeze({
    NODE_OPTIONS: "--require=__caniagent_nonexistent_preload__",
    nOdE_OpTiOnS: "--import=__caniagent_nonexistent_import__",
    NODE_EXTRA_CA_CERTS: "/enterprise/ca.pem",
    CANIAGENT_SENTINEL: "preserve-me"
  });
  const env = isolatedProbeEnvironment(path.join(os.tmpdir(), "caniagent-probe-node-options"), inherited);
  assert.equal(Object.keys(env).some((key) => key.toUpperCase() === "NODE_OPTIONS"), false);
  assert.equal(env.NODE_EXTRA_CA_CERTS, "/enterprise/ca.pem");
  assert.equal(env.CANIAGENT_SENTINEL, "preserve-me");
  assert.equal(inherited.NODE_OPTIONS, "--require=__caniagent_nonexistent_preload__");
  assert.equal(inherited.nOdE_OpTiOnS, "--import=__caniagent_nonexistent_import__");
});

test("behavior probe child process ignores inherited Node preload options", () => {
  const env = isolatedProbeEnvironment(path.join(os.tmpdir(), "caniagent-probe-node-child"), {
    NODE_OPTIONS: "--require=__caniagent_nonexistent_preload__"
  });
  const child = spawnSync(process.execPath, ["-e", 'process.stdout.write("CHILD_OK")'], {
    env, encoding: "utf8", timeout: 5000
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "CHILD_OK");
});

test("behavior probe removes mixed-case aliases of every isolated path on Windows", () => {
  const keys = [...Object.keys(overrides), "NODE_OPTIONS"];
  const inherited = Object.freeze(Object.fromEntries([
    ...keys.map((key) => [key.toLowerCase(), `/outside/${key}`]),
    ["CANIAGENT_SENTINEL", "preserve-me"],
    ["NODE_EXTRA_CA_CERTS", "/enterprise/ca.pem"]
  ]));
  const env = isolatedProbeEnvironment(path.join(os.tmpdir(), "caniagent-case-variants"), inherited);
  for (const key of keys) {
    assert.equal(Object.keys(env).filter((name) => name.toUpperCase() === key).length, key === "NODE_OPTIONS" ? 0 : 1, key);
    assert.equal(Object.hasOwn(env, key.toLowerCase()), false, key);
    assert.equal(inherited[key.toLowerCase()], `/outside/${key}`);
  }
  assert.equal(env.CANIAGENT_SENTINEL, "preserve-me");
  assert.equal(env.NODE_EXTRA_CA_CERTS, "/enterprise/ca.pem");
});

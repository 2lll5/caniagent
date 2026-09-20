import test from "node:test";
import assert from "node:assert/strict";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "../scripts/probe-utils.js";

test("redacts home directory paths", () => {
  const home = "/Users/example";
  const input = "config: /Users/example/.agent/config.json";
  assert.equal(redactProbeOutput(input, { home }), "config: <HOME>/.agent/config.json");
});

test("redacts Windows home paths across case and separator differences", () => {
  const home = "C:\\Users\\Example";
  const input = "config: c:/users/example/.agent/config.json\ncache: C:\\USERS\\EXAMPLE\\.cache";
  assert.equal(
    redactProbeOutput(input, { home }),
    "config: <HOME>/.agent/config.json\ncache: <HOME>\\.cache"
  );
});

test("redacts common credential shapes while preserving labels", () => {
  const input = [
    "Authorization: Bearer abc.def.ghi",
    "api_key=super-secret-value",
    "token: top-secret-value",
    "sk-abcdefghijklmnopqrstuvwxyz"
  ].join("\n");

  const output = redactProbeOutput(input, { home: "" });
  assert.equal(output.includes("abc.def.ghi"), false);
  assert.equal(output.includes("super-secret-value"), false);
  assert.equal(output.includes("top-secret-value"), false);
  assert.equal(output.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
  assert.match(output, /Bearer <REDACTED>/);
  assert.match(output, /api_key=<REDACTED>/);
  assert.match(output, /token: <REDACTED>/);
});

test("redacts prefixed secret environment variable assignments", () => {
  const input = [
    "OPENAI_API_KEY=opaque-provider-value",
    "AWS_SECRET_ACCESS_KEY: opaque-aws-value",
    "MY_SERVICE_TOKEN=opaque-service-value",
    "DEPLOY_PASSWORD=opaque-password",
    "SIGNING_PRIVATE_KEY=opaque-private-key"
  ].join("\n");
  const output = redactProbeOutput(input, { home: "" });

  for (const secret of ["opaque-provider-value", "opaque-aws-value", "opaque-service-value", "opaque-password", "opaque-private-key"]) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /OPENAI_API_KEY=<REDACTED>/);
  assert.match(output, /AWS_SECRET_ACCESS_KEY: <REDACTED>/);
  assert.match(output, /MY_SERVICE_TOKEN=<REDACTED>/);
  assert.match(output, /DEPLOY_PASSWORD=<REDACTED>/);
  assert.match(output, /SIGNING_PRIVATE_KEY=<REDACTED>/);
});

test("redacts credentials embedded in URLs while preserving destinations", () => {
  const input = [
    "registry=https://build-user:super-secret@registry.example.test/npm",
    "proxy HTTP://alice:p%40ssword@proxy.example.test:8080"
  ].join("\n");
  const output = redactProbeOutput(input, { home: "" });

  assert.equal(output.includes("build-user"), false);
  assert.equal(output.includes("super-secret"), false);
  assert.equal(output.includes("alice"), false);
  assert.equal(output.includes("p%40ssword"), false);
  assert.match(output, /https:\/\/<REDACTED>:<REDACTED>@registry\.example\.test\/npm/);
  assert.match(output, /HTTP:\/\/<REDACTED>:<REDACTED>@proxy\.example\.test:8080/);
});

test("redacts modern GitHub and npm token prefixes without labels", () => {
  const githubToken = "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH";
  const npmToken = "npm_abcdefghijklmnopqrstuvwxyz1234567890";
  const input = `github=${githubToken}\nnpm=${npmToken}`;
  const output = redactProbeOutput(input, { home: "" });

  assert.equal(output.includes(githubToken), false);
  assert.equal(output.includes(npmToken), false);
  assert.equal(output, "github=<REDACTED>\nnpm=<REDACTED>");
});

test("redacts credentials embedded in command-shaped output", () => {
  const input = "agent run --api-key=super-secret-value --token: top-secret-value";
  const output = redactProbeOutput(input, { home: "" });
  assert.equal(output.includes("super-secret-value"), false);
  assert.equal(output.includes("top-secret-value"), false);
  assert.match(output, /--api-key=<REDACTED>/);
  assert.match(output, /--token: <REDACTED>/);
});

test("redacts secrets before truncating probe output", () => {
  const token = "github_pat_11AA22BB33CC44DD55EE66FF77GG88HH";
  const input = `${"x".repeat(20)}${token}`;
  const output = redactAndTruncateProbeOutput(input, { maxLength: 35, home: "" });

  assert.equal(output.includes("github_pat_"), false);
  assert.equal(output.includes("11AA"), false);
  assert.equal(output, `${"x".repeat(20)}<REDACTED>`);
});

test("leaves ordinary diagnostic output intact", () => {
  const input = "codex-cli 1.2.3\nUsage: codex [options]";
  assert.equal(redactProbeOutput(input, { home: "" }), input);
});

test("classifies probe execution outcomes without conflating process failures", () => {
  assert.equal(classifyProbeExecution({ status: 0 }), "success");
  assert.equal(classifyProbeExecution({ status: 2 }), "nonzero_exit");
  assert.equal(classifyProbeExecution({ status: null, signal: "SIGTERM" }), "signaled");
  assert.equal(classifyProbeExecution({ status: null, error: { code: "ENOENT" } }), "not_found");
  assert.equal(classifyProbeExecution({ status: null, error: { code: "ETIMEDOUT" } }), "timeout");
  assert.equal(classifyProbeExecution({ status: null, error: { code: "EACCES" } }), "spawn_error");
});

import test from "node:test";
import assert from "node:assert/strict";
import { redactProbeOutput } from "../scripts/probe-utils.js";

test("redacts home directory paths", () => {
  const home = "/Users/example";
  const input = "config: /Users/example/.agent/config.json";
  assert.equal(redactProbeOutput(input, { home }), "config: <HOME>/.agent/config.json");
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

test("leaves ordinary diagnostic output intact", () => {
  const input = "codex-cli 1.2.3\nUsage: codex [options]";
  assert.equal(redactProbeOutput(input, { home: "" }), input);
});

import test from "node:test";
import assert from "node:assert/strict";
import { STRUCTURED_OUTPUT_SPECS, classifyStructuredOutput, parseStructuredOutput } from "../scripts/probe-structured-output.js";

test("structured-output adapters encode documented machine-readable modes", () => {
  assert.equal(STRUCTURED_OUTPUT_SPECS.codex.format, "jsonl");
  assert.deepEqual(STRUCTURED_OUTPUT_SPECS.codex.args("marker"), ["exec", "--ephemeral", "--json", "marker"]);
  assert.equal(STRUCTURED_OUTPUT_SPECS["claude-code"].format, "json");
  assert.deepEqual(STRUCTURED_OUTPUT_SPECS["claude-code"].args("marker"), ["-p", "marker", "--output-format", "json"]);
  assert.equal(STRUCTURED_OUTPUT_SPECS["gemini-cli"].format, "json");
  assert.deepEqual(STRUCTURED_OUTPUT_SPECS["gemini-cli"].args("marker"), ["-p", "marker", "--output-format", "json"]);
  assert.equal(STRUCTURED_OUTPUT_SPECS.opencode.format, "jsonl");
  assert.deepEqual(STRUCTURED_OUTPUT_SPECS.opencode.args("marker"), ["run", "--format", "json", "marker"]);
});

test("parser accepts JSON documents and JSONL event streams", () => {
  assert.deepEqual(parseStructuredOutput('{"response":"ok"}', "json"), [{ response: "ok" }]);
  assert.deepEqual(parseStructuredOutput('{"type":"start"}\n{"type":"result","text":"ok"}\n', "jsonl"), [
    { type: "start" },
    { type: "result", text: "ok" }
  ]);
});

test("successful malformed structured output is a reproducible failure", () => {
  assert.deepEqual(classifyStructuredOutput("not json", "json", "MARKER"), {
    parseable: false,
    markerObserved: false,
    verdict: "fail"
  });
});

test("marker must be observed before structured output passes", () => {
  assert.deepEqual(classifyStructuredOutput('{"response":"MARKER"}', "json", "MARKER"), {
    parseable: true,
    markerObserved: true,
    verdict: "pass"
  });
  assert.deepEqual(classifyStructuredOutput('{"response":"other"}', "json", "MARKER"), {
    parseable: true,
    markerObserved: false,
    verdict: "inconclusive"
  });
});

test("runtime failures stay inconclusive even if output resembles evidence", () => {
  assert.deepEqual(classifyStructuredOutput('{"response":"MARKER"}', "json", "MARKER", "error"), {
    parseable: false,
    markerObserved: false,
    verdict: "inconclusive"
  });
});

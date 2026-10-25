import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STRUCTURED_OUTPUT_SPECS, classifyStructuredOutput, parseStructuredOutput, runStructuredOutput } from "../scripts/probe-structured-output.js";

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

// These cases exercise the real child-process boundary, not just the parser.
// The public execution artifact must stay redacted/truncated while verdicts
// use the complete raw stdout held only during classification.
test("structured probe classifies raw stdout without persisting it", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const secret = "sk-abcdefghijklmnopqrstuv"; // synthetic fixture, never a credential
  const scenarios = [
    {
      name: "large valid JSON", format: "json",
      stdout: JSON.stringify({ padding: "x".repeat(13000), response: marker }),
      rawVerdict: "pass", evidenceVerdict: "fail"
    },
    {
      name: "large valid JSONL", format: "jsonl",
      stdout: JSON.stringify({ type: "metadata", padding: "x".repeat(13000) }) + "\n" + JSON.stringify({ type: "result", text: marker }),
      rawVerdict: "pass", evidenceVerdict: "fail"
    },
    {
      name: "malformed tail after a valid JSONL marker", format: "jsonl",
      stdout: JSON.stringify({ type: "result", text: marker }) + "\n" + " ".repeat(13000) + "NOT_JSON",
      rawVerdict: "fail", evidenceVerdict: "pass"
    },
    {
      name: "small JSON with a synthetic secret", format: "json",
      stdout: JSON.stringify({ response: marker, debug: secret }),
      rawVerdict: "pass", evidenceVerdict: "pass"
    },
    {
      name: "valid JSON beyond Node's default 1 MiB child buffer", format: "json",
      stdout: JSON.stringify({ padding: "x".repeat(1_100_000), response: marker }),
      rawVerdict: "pass", evidenceVerdict: "fail"
    }
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-structured-raw-"));
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const fixture = path.join(dir, `fixture-${index}.cjs`);
      fs.writeFileSync(fixture, `process.stdout.write(${JSON.stringify(scenario.stdout)});\n`);
      const { execution, ...classification } = runStructuredOutput(process.execPath, [fixture], {
        format: scenario.format, marker
      });
      assert.equal(execution.outcome, "success", scenario.name);
      assert.equal(classification.verdict, scenario.rawVerdict, scenario.name);
      assert.equal(classifyStructuredOutput(execution.stdout, scenario.format, marker).verdict,
        scenario.evidenceVerdict, `${scenario.name} truncated evidence`);
      assert.ok(execution.stdout.length <= 12000, scenario.name);
      assert.equal(Object.hasOwn(execution, "rawStdout"), false, scenario.name);
      assert.ok(!JSON.stringify({ execution, ...classification }).includes(secret), scenario.name);
      if (index === 3) assert.ok(execution.stdout.includes("<REDACTED>"));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

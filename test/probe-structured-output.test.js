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

test("prompt echoes and nested metadata cannot supply response provenance", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const cases = [
    [JSON.stringify({ type: "request", prompt: marker, response: marker }), "json"],
    [JSON.stringify({ metadata: { prompt: marker, response: marker } }), "json"],
    [[{ type: "input", text: marker }, { type: "result", text: "other" }].map(JSON.stringify).join("\n"), "jsonl"],
    [JSON.stringify({ response: `I was asked to say ${marker}, but did not` }), "json"]
  ];
  for (const [output, format] of cases) {
    assert.deepEqual(classifyStructuredOutput(output, format, marker), {
      parseable: true, markerObserved: false, verdict: "inconclusive"
    });
  }
});

test("adapter-specific model response fields are the only positive evidence", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const cases = [
    ["codex", "jsonl", { type: "item.completed", item: { type: "agent_message", text: marker } }],
    ["opencode", "jsonl", { type: "text", part: { type: "text", text: marker } }],
    ["claude-code", "json", { type: "result", result: marker }],
    ["gemini-cli", "json", { response: marker }]
  ];
  for (const [agent, format, response] of cases) {
    assert.equal(classifyStructuredOutput(JSON.stringify(response), format, marker, "success", agent).verdict, "pass", agent);
  }
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "item.completed", item: { type: "user_message", text: marker } }), "jsonl", marker, "success", "codex").verdict, "inconclusive");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "input", part: { type: "text", text: marker } }), "jsonl", marker, "success", "opencode").verdict, "inconclusive");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "result", is_error: true, result: marker }), "json", marker, "success", "claude-code").verdict, "inconclusive");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "request", response: marker }), "json", marker, "success", "gemini-cli").verdict, "inconclusive");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "unknown", debug: marker }), "json", marker, "success", "gemini-cli").verdict, "inconclusive");
});

test("unknown diagnostic events and explicit error results cannot establish marker provenance", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  for (const [agent, value] of [
    [undefined, { type: "diagnostic", response: marker }],
    [undefined, { type: "result", is_error: true, result: marker }],
    ["gemini-cli", { type: "result", is_error: true, response: marker }]
  ]) {
    assert.deepEqual(classifyStructuredOutput(JSON.stringify(value), "json", marker, "success", agent), {
      parseable: true, markerObserved: false, verdict: "inconclusive"
    });
  }
  // Existing direct-parser callers retain supported positive response envelopes.
  assert.equal(classifyStructuredOutput(JSON.stringify({ response: marker }), "json", marker).verdict, "pass");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "result", result: marker }), "json", marker).verdict, "pass");
  assert.equal(classifyStructuredOutput(JSON.stringify({ response: marker }), "json", marker, "success", "gemini-cli").verdict, "pass");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: marker } }), "jsonl", marker).verdict, "pass");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "text", part: { type: "text", text: marker } }), "jsonl", marker).verdict, "pass");
});

test("real child-process prompt echo stays inconclusive while a Codex agent message passes", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-structured-provenance-"));
  try {
    for (const [name, events, expected] of [
      ["echo", [{ type: "input", text: marker }, { type: "turn.completed", usage: {} }], "inconclusive"],
      ["answer", [{ type: "input", text: marker }, { type: "item.completed", item: { type: "agent_message", text: marker } }], "pass"]
    ]) {
      const fixture = path.join(dir, `${name}.cjs`);
      fs.writeFileSync(fixture, `process.stdout.write(${JSON.stringify(events.map(JSON.stringify).join("\n"))});\n`);
      const { execution, ...classification } = runStructuredOutput(process.execPath, [fixture], {
        format: "jsonl", marker, agent: "codex"
      });
      assert.equal(execution.outcome, "success", name);
      assert.equal(classification.verdict, expected, name);
      assert.equal(Object.hasOwn(execution, "rawStdout"), false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit failure events invalidate earlier response markers", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const cases = [
    ["codex", "jsonl", [
      { type: "item.completed", item: { type: "agent_message", text: marker } },
      { type: "turn.failed", error: { message: "synthetic failure" } }
    ]],
    ["opencode", "jsonl", [
      { type: "text", part: { type: "text", text: marker } },
      { type: "error", error: { message: "synthetic failure" } }
    ]],
    ["claude-code", "json", [
      { type: "result", subtype: "error_max_turns", is_error: false, result: marker }
    ]],
    ["gemini-cli", "json", [
      { type: "error", response: marker }
    ]],
    ["codex", "jsonl", [
      { type: "item.completed", item: { type: "agent_message", text: marker } },
      { type: "diagnostic", is_error: true }
    ]]
  ];
  for (const [agent, format, events] of cases) {
    const output = format === "jsonl" ? events.map(JSON.stringify).join("\n") : JSON.stringify(events[0]);
    assert.deepEqual(classifyStructuredOutput(output, format, marker, "success", agent), {
      parseable: true, markerObserved: false, verdict: "inconclusive"
    }, agent);
  }
});

test("terminal failures invalidate markers across adapters and direct parsing", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const cases = [
    ["codex", "jsonl", [
      { type: "item.completed", item: { type: "agent_message", text: marker } },
      { type: "error", message: "synthetic failure" }
    ]],
    ["opencode", "jsonl", [
      { type: "text", part: { type: "text", text: marker } },
      { type: "turn.failed", error: { message: "synthetic failure" } }
    ]],
    [undefined, "jsonl", [
      { type: "result", text: marker },
      { type: "error", message: "synthetic failure" }
    ]],
    [undefined, "json", [
      { type: "result", subtype: "error_max_turns", result: marker }
    ]]
  ];
  for (const [agent, format, events] of cases) {
    const output = format === "jsonl" ? events.map(JSON.stringify).join("\n") : JSON.stringify(events[0]);
    assert.deepEqual(classifyStructuredOutput(output, format, marker, "success", agent), {
      parseable: true, markerObserved: false, verdict: "inconclusive"
    }, agent ?? "direct-parser");
  }
  // Non-failure events and legitimate responses must still pass.
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "result", result: marker }), "json", marker).verdict, "pass");
  assert.equal(classifyStructuredOutput(JSON.stringify({ type: "result", subtype: "success", result: marker }), "json", marker, "success", "claude-code").verdict, "pass");
  assert.equal(classifyStructuredOutput([
    { type: "item.completed", item: { type: "agent_message", text: marker } },
    { type: "turn.completed" }
  ].map(JSON.stringify).join("\n"), "jsonl", marker, "success", "codex").verdict, "pass");
});

test("known successful responses remain valid and unknown adapters fail closed", () => {
  const marker = "CANIAGENT_STRUCTURED_TEST_MARKER";
  const cases = [
    ["codex", "jsonl", [
      { type: "item.completed", item: { type: "agent_message", text: marker } },
      { type: "turn.completed" }
    ]],
    ["opencode", "jsonl", [
      { type: "text", part: { type: "text", text: marker } },
      { type: "step_finish" }
    ]],
    ["claude-code", "json", [{ type: "result", subtype: "success", result: marker }]],
    ["gemini-cli", "json", [{ response: marker }]]
  ];
  for (const [agent, format, events] of cases) {
    const output = format === "jsonl" ? events.map(JSON.stringify).join("\n") : JSON.stringify(events[0]);
    assert.equal(classifyStructuredOutput(output, format, marker, "success", agent).verdict, "pass", agent);
  }
  assert.deepEqual(classifyStructuredOutput(JSON.stringify({ response: marker }), "json", marker, "success", "future-agent"), {
    parseable: true, markerObserved: false, verdict: "inconclusive"
  });
  assert.equal(classifyStructuredOutput(JSON.stringify({ response: marker }), "json", marker).verdict, "pass");
});

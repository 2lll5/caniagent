import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_PROBE_SPECS, captureSkillProbeResult, classifySkillOutput, createSkillFixture, runSkillProbe } from "../scripts/probe-skills.js";
import { isolatedProbeEnvironment } from "../scripts/probe-env.js";

test("skill probe adapters use documented project discovery conventions", () => {
  assert.deepEqual(SKILL_PROBE_SPECS.codex.projectPath, [".agents", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["claude-code"].projectPath, [".claude", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["gemini-cli"].projectPath, [".gemini", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS.opencode.projectPath, [".opencode", "skills"]);
});

test("skill probe adapters only encode documented isolated user discovery conventions", () => {
  assert.deepEqual(SKILL_PROBE_SPECS.codex.userPath, [".agents", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["claude-code"].userPath, [".claude", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS["gemini-cli"].userPath, [".gemini", "skills"]);
  assert.deepEqual(SKILL_PROBE_SPECS.opencode.userPath, [".config", "opencode", "skills"]);
});

test("Codex skill probe runs from a non-Git fixture with an explicit bypass", () => {
  assert.deepEqual(SKILL_PROBE_SPECS.codex.args("probe"), [
    "exec", "--ephemeral", "--skip-git-repo-check", "--json", "probe"
  ]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-codex-skill-git-check-test-"));
  try {
    for (const scope of ["project", "user"]) {
      const fixture = createSkillFixture(temp, "codex", scope);
      assert.equal(fs.existsSync(path.join(fixture.workspace, ".git")), false);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});


test("Codex skill probe requires a completed JSONL model reply, not a tool echo", () => {
  assert.equal(SKILL_PROBE_SPECS.codex.outputFormat, "codex-result-jsonl");
  const marker = "CANIAGENT_SKILL_CODEX_USER";
  const pass = { discovered: true, verdict: "pass" };
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  const stream = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
  const start = { type: "turn.started" };
  const end = { type: "turn.completed" };
  const message = (text) => ({ type: "item.completed", item: { type: "agent_message", text } });
  const tool = { type: "item.completed", item: { type: "command_execution", aggregated_output: marker } };
  const classify = (stdout, outcome = "success") =>
    classifySkillOutput(stdout, marker, outcome, "codex-result-jsonl");

  assert.deepEqual(classify(stream({ type: "thread.started" }, start, tool, message(marker), end)), pass);
  assert.deepEqual(classify(stream(start, message(` ${marker} `), end)), pass);
  assert.deepEqual(classify(stream(start, tool, message("skill unavailable"), end)), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker), tool, end)), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker), message("skill unavailable"), end)), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker))), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker), { type: "turn.failed" })), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker), { type: "error", message: "oops" }, end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.failed", item: { type: "command_execution", error: "skill activation failed" } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.failed", item: { type: "agent_message", text: marker } }, message(marker), end)), inconclusive);
  // Codex also reports tool failures in item.completed, not only item.failed.
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "command_execution", status: "failed", exit_code: 1 } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "command_execution", status: "completed", exit_code: 1 } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "command_execution", status: "declined" } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "mcp_tool_call", status: "failed" } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "mcp_tool_call", status: "completed", error: "permission denied" } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "command_execution", status: "completed", exit_code: 0 } }, message(marker), end)), pass);
  assert.deepEqual(classify(stream(start, { type: "item.completed", item: { type: "mcp_tool_call", status: "completed", error: null } }, message(marker), end)), pass);
  // A final model marker cannot certify a turn with an unfinished tool.
  const startedTool = { type: "item.started", item: { id: "tool-1", type: "command_execution" } };
  const completedTool = { type: "item.completed", item: { id: "tool-1", type: "command_execution", exit_code: 0 } };
  assert.deepEqual(classify(stream(start, startedTool, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, startedTool, completedTool, message(marker), end)), pass);
  assert.deepEqual(classify(stream(start, startedTool, { ...completedTool, item: { ...completedTool.item, id: "other" } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.started", item: { type: "mcp_tool_call" } }, message(marker), end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.started", item: { id: "mcp-1", type: "mcp_tool_call" } }, { type: "item.completed", item: { id: "mcp-1", type: "mcp_tool_call", error: null } }, message(marker), end)), pass);
  assert.deepEqual(classify(stream(start, message(marker), end, start, end)), inconclusive);
  assert.deepEqual(classify(stream(start, { type: "item.started", item: { type: "agent_message", text: marker } }, end)), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker), end) + "\n{"), inconclusive);
  assert.deepEqual(classify(marker), inconclusive);
  assert.deepEqual(classify(stream(start, message(marker), end), "timeout"), inconclusive);
  const { markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout: stream(start, tool, message("unavailable"), end), stderr: "" },
    "fake-codex", ["exec", "--json"], marker, "codex-result-jsonl"
  );
  assert.deepEqual(markerVerdict, inconclusive);
});

test("OpenCode skill probe requests JSONL final-response events", () => {
  assert.equal(SKILL_PROBE_SPECS.opencode.outputFormat, "opencode-result-jsonl");
  assert.deepEqual(SKILL_PROBE_SPECS.opencode.args("probe"), ["run", "--format", "json", "probe"]);
});

test("OpenCode skill marker requires final model text, not a tool or prior step", () => {
  const marker = "CANIAGENT_SKILL_OPENCODE_USER";
  const pass = { discovered: true, verdict: "pass" };
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  const stream = (...events) => events.map((event) => JSON.stringify(event)).join("\n");
  const start = { type: "step_start", part: { type: "step-start" } };
  const end = { type: "step_finish", part: { type: "step-finish", reason: "stop" } };
  const message = (text) => ({ type: "text", part: { type: "text", text } });
  const tool = { type: "tool_use", part: { type: "tool", state: { status: "completed", output: marker } } };
  const classify = (stdout, outcome = "success") =>
    classifySkillOutput(stdout, marker, outcome, "opencode-result-jsonl");
  const cases = [
    [stream(start, message(marker), end), pass],
    [stream(start, tool, message(marker), end), pass],
    [stream(start, message(marker), { type: "reasoning", part: { type: "reasoning", text: "continuing" } }), inconclusive],
    [stream(start, message(marker), { type: "future_tool_event", part: { type: "tool" } }), inconclusive],
    [stream(start, message(marker), end, { type: "unexpected_terminal" }), inconclusive],
    [stream(start, message(marker)), pass],
    [stream(message(marker), end), inconclusive],
    [stream(start, end, message(marker)), inconclusive],
    [stream(start, end, start, message(marker), end), pass],
    [stream(start, tool, message("not loaded"), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", state: { status: "error", error: "skill activation failed" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", state: { status: "failed" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", state: { status: "declined" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", state: { status: "completed", error: "permission denied" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", state: { status: "completed", error: null } } }, message(marker), end), pass],
    // Unfinished tool calls must not be hidden by a later correct model marker.
    [stream(start, { type: "tool_use", part: { type: "tool", state: { output: marker } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", state: { status: "pending" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "pending" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "running" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "pending" } } },
      { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "completed" } } }, message(marker), end), pass],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "running" } } },
      { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "completed" } } }, message(marker), end), pass],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "pending" } } },
      { type: "tool_use", part: { type: "tool", callID: "b", state: { status: "completed" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "completed" } } },
      { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "pending" } } }, message(marker), end), inconclusive],
    [stream(start, { type: "tool_use", part: { type: "tool", callID: "a", state: { status: "unknown" } } }, message(marker), end), inconclusive],
    [stream(start, message(marker), tool, end), inconclusive],
    [stream(start, message(marker), start, end), inconclusive],
    [stream(start, message(marker), message("unavailable"), end), inconclusive],
    [stream(start, message(marker), { type: "step_finish", part: { type: "step-finish", reason: "tool-calls" } }), inconclusive],
    [stream(start, message(marker), { type: "error", error: { message: "failure" } }), inconclusive],
    [stream(start, message(marker), { type: "text", part: { type: "error", text: marker } }), inconclusive],
    [stream(start, message(` ${marker} `), end), inconclusive],
    [stream(start, tool, end), inconclusive],
    [marker, inconclusive],
    [stream(start, message(marker), end) + "\n{", inconclusive],
    [stream(start, message(marker), end), inconclusive, "timeout"],
    [stream(start, message(marker), end) + "\n", pass]
  ];
  for (const [index, [stdout, expected, outcome]] of cases.entries()) {
    assert.deepEqual(classify(stdout, outcome), expected, `OpenCode JSONL case ${index + 1}`);
  }
  const { markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout: stream(start, tool, end), stderr: "" },
    "fake-opencode", ["run", "--format", "json"], marker, "opencode-result-jsonl"
  );
  assert.deepEqual(markerVerdict, inconclusive);
});

test("Claude Code skill probe requests a structured final result", () => {
  assert.equal(SKILL_PROBE_SPECS["claude-code"].outputFormat, "claude-result-json");
  assert.deepEqual(SKILL_PROBE_SPECS["claude-code"].args("probe"), [
    "-p", "probe", "--output-format", "json"
  ]);
});

test("Claude Code skill marker requires the final JSON model result, not tool echoes", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const pass = { discovered: true, verdict: "pass" };
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  const classify = (value) => classifySkillOutput(
    typeof value === "string" ? value : JSON.stringify(value),
    marker, "success", "claude-result-json"
  );
  assert.deepEqual(classify({ type: "result", subtype: "success", is_error: false, result: marker }), pass);
  assert.deepEqual(classify({ type: "result", result: ` ${marker} ` }), pass);
  assert.deepEqual(classify({ type: "result", result: "Skill unavailable", tool_output: marker }), inconclusive);
  assert.deepEqual(classify({ type: "assistant", message: { content: [{ type: "text", text: marker }] } }), inconclusive);
  assert.deepEqual(classify({ type: "result", result: "Skill unavailable", prompt: marker }), inconclusive);
  assert.deepEqual(classify({ type: "result", result: marker, is_error: true }), inconclusive);
  assert.deepEqual(classify({ type: "result", result: marker, subtype: "error_max_turns" }), inconclusive);
  assert.deepEqual(classify(marker), inconclusive);
  assert.deepEqual(classify("not json"), inconclusive);
  assert.deepEqual(classifySkillOutput(JSON.stringify({ type: "result", result: marker }), marker, "timeout", "claude-result-json"), inconclusive);
  assert.deepEqual(classifySkillOutput(marker, marker, "success", "unknown-format"), inconclusive);
  const { markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout: JSON.stringify({ type: "result", result: "unavailable", tool_output: marker }), stderr: "" },
    "fake-claude", ["-p", "probe"], marker, "claude-result-json"
  );
  assert.deepEqual(markerVerdict, inconclusive);
});

test("Gemini skill probe requests a structured final response in non-interactive mode", () => {
  assert.equal(SKILL_PROBE_SPECS["gemini-cli"].outputFormat, "gemini-result-json");
  assert.deepEqual(SKILL_PROBE_SPECS["gemini-cli"].args("probe"), [
    "--approval-mode=yolo", "-p", "probe", "--output-format", "json"
  ]);
});

test("Gemini skill verdict uses only the successful final JSON response", () => {
  const marker = "CANIAGENT_SKILL_GEMINI_CLI_USER";
  const pass = { discovered: true, verdict: "pass" };
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  const classify = (value) => classifySkillOutput(
    typeof value === "string" ? value : JSON.stringify(value),
    marker, "success", "gemini-result-json"
  );
  assert.deepEqual(classify({ response: marker, stats: { tools: { totalCalls: 1 } } }), pass);
  assert.deepEqual(classify({ response: ` ${marker} `, error: null }), pass);
  assert.deepEqual(classify({ type: "result", response: marker }), pass);
  assert.deepEqual(classify({ response: "Skill unavailable", tool_output: marker }), inconclusive);
  assert.deepEqual(classify({ response: marker, error: { type: "FatalToolExecutionError" } }), inconclusive);
  assert.deepEqual(classify({ response: marker, is_error: true }), inconclusive);
  assert.deepEqual(classify({ type: "tool_result", response: marker }), inconclusive);
  assert.deepEqual(classify([{ response: marker }]), inconclusive);
  assert.deepEqual(classify(marker), inconclusive);
  assert.deepEqual(classify("not json"), inconclusive);
  assert.deepEqual(classifySkillOutput(JSON.stringify({ response: marker }), marker, "timeout", "gemini-result-json"), inconclusive);
  const { markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout: JSON.stringify({ response: "unavailable", tool_output: marker }), stderr: "" },
    "fake-gemini", ["-p", "probe"], marker, "gemini-result-json"
  );
  assert.deepEqual(markerVerdict, inconclusive);
});

test("skill fixture marker is a fresh unpredictable challenge, not derivable from the skill name", () => {
  const firstDir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skills-random-a-"));
  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skills-random-b-"));
  try {
    const first = createSkillFixture(firstDir, "codex", "project");
    const second = createSkillFixture(secondDir, "codex", "project");
    assert.equal(first.skillName, second.skillName);
    assert.match(first.marker, /^CANIAGENT_SKILL_[A-F0-9]{32}$/);
    assert.match(second.marker, /^CANIAGENT_SKILL_[A-F0-9]{32}$/);
    assert.notEqual(first.marker, second.marker);
    assert.notEqual(first.marker, "CANIAGENT_SKILL_CODEX_PROJECT");
    assert.match(fs.readFileSync(path.join(first.skillDir, "SKILL.md"), "utf8"), new RegExp(first.marker));
    assert.equal(first.skillName.includes(first.marker), false);
    assert.equal(first.discoveryPath.includes(first.marker), false);
    assert.equal(fs.readFileSync(path.join(first.workspace, "README.md"), "utf8").includes(first.marker), false);
  } finally {
    fs.rmSync(firstDir, { recursive: true, force: true });
    fs.rmSync(secondDir, { recursive: true, force: true });
  }
});

test("project skill fixture contains the generated marker only inside SKILL.md", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-probe-test-"));
  try {
    const fixture = createSkillFixture(temp, "codex");
    assert.equal(fixture.discoveryPath, `.agents/skills/${fixture.skillName}/`);
    const skill = fs.readFileSync(path.join(fixture.skillDir, "SKILL.md"), "utf8");
    assert.match(skill, new RegExp(fixture.marker));
    assert.doesNotMatch(fs.readFileSync(path.join(fixture.workspace, "README.md"), "utf8"), new RegExp(fixture.marker));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("user skill fixture stays inside the isolated home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-user-probe-test-"));
  try {
    const fixture = createSkillFixture(temp, "opencode", "user");
    assert.equal(fixture.discoveryPath, `~/.config/opencode/skills/${fixture.skillName}/`);
    assert.equal(path.relative(path.join(temp, "home"), fixture.skillDir).startsWith(".."), false);
    assert.equal(fs.existsSync(path.join(fixture.skillDir, "SKILL.md")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Gemini user skill fixture stays inside the isolated home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-gemini-skill-user-probe-test-"));
  try {
    const fixture = createSkillFixture(temp, "gemini-cli", "user");
    assert.equal(fixture.discoveryPath, `~/.gemini/skills/${fixture.skillName}/`);
    assert.equal(path.relative(path.join(temp, "home"), fixture.skillDir).startsWith(".."), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Claude Code personal skill fixture uses only the isolated config home", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-claude-personal-skill-test-"));
  try {
    const fixture = createSkillFixture(temp, "claude-code", "user");
    const env = isolatedProbeEnvironment(path.join(temp, "home"), {
      HOME: "/outside/home",
      CLAUDE_CONFIG_DIR: "/outside/claude"
    });
    assert.equal(fixture.discoveryPath, `~/.claude/skills/${fixture.skillName}/`);
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(temp, "home", ".claude"));
    assert.equal(path.relative(env.CLAUDE_CONFIG_DIR, fixture.skillDir), path.join("skills", fixture.skillName));
    assert.equal(fs.existsSync(path.join(fixture.skillDir, "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(fixture.workspace, ".claude", "skills", fixture.skillName, "SKILL.md")), false);
    assert.match(fs.readFileSync(path.join(fixture.skillDir, "SKILL.md"), "utf8"), new RegExp(fixture.marker));
    assert.doesNotMatch(fs.readFileSync(path.join(fixture.workspace, "README.md"), "utf8"), new RegExp(fixture.marker));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("undocumented skill scope is rejected instead of guessed", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skill-unknown-scope-test-"));
  try {
    assert.throws(() => createSkillFixture(temp, "claude-code", "system"), /No system-scope Agent Skills discovery path/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("skill output classification never turns missing evidence into unsupported", () => {
  assert.deepEqual(classifySkillOutput("CANIAGENT_SKILL_CODEX_PROJECT", "CANIAGENT_SKILL_CODEX_PROJECT"), { discovered: true, verdict: "pass" });
  assert.deepEqual(classifySkillOutput("prefix CANIAGENT_SKILL_CODEX_PROJECT suffix", "CANIAGENT_SKILL_CODEX_PROJECT"), { discovered: false, verdict: "inconclusive" });
  assert.deepEqual(classifySkillOutput("no marker", "CANIAGENT_SKILL_CODEX_PROJECT"), { discovered: false, verdict: "inconclusive" });
  assert.deepEqual(classifySkillOutput("CANIAGENT_SKILL_CODEX_PROJECT", "CANIAGENT_SKILL_CODEX_PROJECT", "error"), { discovered: false, verdict: "inconclusive" });
});

test("skill marker must be a standalone stdout line, not a tool echo or substring", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  assert.deepEqual(classifySkillOutput(`When invoked for the probe, reply with exactly: ${marker}`, marker), inconclusive);
  assert.deepEqual(classifySkillOutput(`prefix ${marker} suffix`, marker), inconclusive);
  assert.deepEqual(classifySkillOutput(`${marker}_EXTRA`, marker), inconclusive);
  assert.deepEqual(classifySkillOutput(`logs\r\n ${marker} \r\n`, marker), { discovered: true, verdict: "pass" });
  assert.deepEqual(classifySkillOutput("", ""), inconclusive);
});

test("skill marker must be the last non-empty stdout line, not a prior tool echo", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const inconclusive = { discovered: false, verdict: "inconclusive" };
  const pass = { discovered: true, verdict: "pass" };
  assert.deepEqual(classifySkillOutput(`tool output:\n${marker}\nSkill unavailable.\n`, marker), inconclusive);
  assert.deepEqual(classifySkillOutput(`${marker}\nThe requested skill could not be loaded\n`, marker), inconclusive);
  assert.deepEqual(classifySkillOutput(`log line\n ${marker} \r\n \r\n`, marker), pass);
});

test("skill verdict uses full raw stdout while saved evidence stays truncated", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const rawStdout = "x".repeat(13000) + "\n" + marker;
  const { execution, markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout: rawStdout, stderr: "" }, "fake-agent", ["probe"], marker
  );
  assert.deepEqual(markerVerdict, { discovered: true, verdict: "pass" });
  assert.equal(execution.stdout.length, 12000);
  assert.equal(execution.stdout.includes(marker), false);
  assert.equal(JSON.stringify({ execution, markerVerdict }).includes(marker), false);
});

test("random skill challenge is redacted from saved evidence without changing the raw verdict", () => {
  const marker = `CANIAGENT_SKILL_${"A".repeat(32)}`;
  const stdout = JSON.stringify({ type: "result", result: marker, tool_echo: marker });
  const { execution, markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout, stderr: `diagnostic: ${marker}` },
    "fake-claude", ["--marker", marker], marker, "claude-result-json"
  );
  assert.deepEqual(markerVerdict, { discovered: true, verdict: "pass" });
  assert.equal(JSON.stringify(execution).includes(marker), false);
  assert.match(execution.stdout, /<SKILL_MARKER>/);
  assert.match(execution.stderr, /<SKILL_MARKER>/);
  assert.match(execution.command, /<SKILL_MARKER>/);

  const failed = captureSkillProbeResult(
    { status: null, signal: null, stdout: "", stderr: "", error: { code: "EACCES", message: `error ${marker}` } },
    "fake-claude", [], marker, "claude-result-json"
  );
  assert.equal(failed.execution.error.includes(marker), false);
  assert.match(failed.execution.error, /<SKILL_MARKER>/);
  assert.deepEqual(failed.markerVerdict, { discovered: false, verdict: "inconclusive" });
});

test("skill marker in diagnostics alone cannot produce a pass", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const { execution, markerVerdict } = captureSkillProbeResult(
    { status: 0, signal: null, stdout: "", stderr: `diagnostic: ${marker}` },
    "fake-agent", ["probe"], marker
  );
  assert.equal(execution.stderr.includes(marker), false);
  assert.match(execution.stderr, /<SKILL_MARKER>/);
  assert.deepEqual(markerVerdict, { discovered: false, verdict: "inconclusive" });
});

test("failed skill execution stays inconclusive even with raw stdout marker", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const { markerVerdict } = captureSkillProbeResult(
    { status: 1, signal: null, stdout: marker, stderr: "" }, "fake-agent", ["probe"], marker
  );
  assert.deepEqual(markerVerdict, { discovered: false, verdict: "inconclusive" });
});

test("skill probe handles successful stdout beyond Node's default 1 MiB buffer", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skills-large-output-"));
  try {
    const fixture = path.join(dir, "large-output.cjs");
    fs.writeFileSync(fixture, `process.stdout.write("x".repeat(1_100_000) + "\\n" + ${JSON.stringify(marker)});\n`);
    const { execution, markerVerdict } = runSkillProbe(process.execPath, [fixture], { cwd: dir, marker });
    assert.equal(execution.outcome, "success");
    assert.equal(execution.status, 0);
    assert.deepEqual(markerVerdict, { discovered: true, verdict: "pass" });
    assert.equal(execution.stdout.length, 12000);
    assert.equal(JSON.stringify({ execution, markerVerdict }).includes(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("skill probe buffer overflow cannot certify a partial marker", () => {
  const marker = "CANIAGENT_SKILL_CLAUDE_CODE_USER";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-skills-overflow-"));
  try {
    const fixture = path.join(dir, "overflow.cjs");
    // The marker is deliberately emitted after the 8 MiB limit: a partial
    // capture must never become a successful discovery verdict.
    fs.writeFileSync(fixture,
      `process.stdout.write("x".repeat(8 * 1024 * 1024 + 1024) + "\\n" + ${JSON.stringify(marker)});\n`);
    const { execution, markerVerdict } = runSkillProbe(process.execPath, [fixture], { cwd: dir, marker });
    assert.equal(execution.outcome, "spawn_error");
    assert.match(execution.error ?? "", /ENOBUFS/);
    assert.deepEqual(markerVerdict, { discovered: false, verdict: "inconclusive" });
    assert.ok(execution.stdout.length <= 12000);
    assert.equal(JSON.stringify({ execution, markerVerdict }).includes(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

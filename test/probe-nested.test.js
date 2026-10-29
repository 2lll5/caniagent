import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NESTED_PROBE_SPECS, classifyNestedEvidence, classifyNestedMarkers, createNestedInstructionFixture, runNestedProbe, runNestedVersionProbe, summarizeNestedExecution } from "../scripts/probe-nested.js";

test("Codex nested probe explicitly permits its generated non-Git fixture", () => {
  const prompt = "Return the applicable instruction markers";
  assert.deepEqual(NESTED_PROBE_SPECS.codex.args(prompt), [
    "exec", "--ephemeral", "--skip-git-repo-check", prompt
  ]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-codex-nongit-"));
  try {
    const fixture = createNestedInstructionFixture(temp, "codex");
    assert.equal(fs.existsSync(path.join(fixture.workspace, ".git")), false);
    assert.equal(fs.existsSync(path.join(fixture.nested, ".git")), false);
    assert.equal(fs.existsSync(path.join(fixture.nested, "AGENTS.md")), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

for (const agentId of Object.keys(NESTED_PROBE_SPECS)) {
  test(`nested probe creates isolated root and nested instructions for ${agentId}`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-probe-test-"));
    try {
      const fixture = createNestedInstructionFixture(temp, agentId);
      const root = fs.readFileSync(path.join(fixture.workspace, fixture.file), "utf8");
      const nested = fs.readFileSync(path.join(fixture.nested, fixture.file), "utf8");
      assert.match(root, new RegExp(fixture.rootMarker));
      assert.match(nested, new RegExp(fixture.nestedMarker));
      assert.notEqual(fixture.rootMarker, fixture.nestedMarker);
      assert.match(fixture.fixtureSha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(NESTED_PROBE_SPECS[agentId].versionArgs, ["--version"]);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}

test("nested marker classification distinguishes precedence observations", () => {
  const fixture = { rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER" };
  assert.deepEqual(classifyNestedMarkers("ROOT_MARKER NESTED_MARKER", fixture), {
    root: true,
    nested: true,
    verdict: "root-and-nested"
  });
  assert.equal(classifyNestedMarkers("ROOT_MARKER", fixture).verdict, "root-only");
  assert.equal(classifyNestedMarkers("NESTED_MARKER", fixture).verdict, "nested-only");
  assert.equal(classifyNestedMarkers("authentication required", fixture).verdict, "inconclusive");
});

test("nested probe classifies raw stdout, not stderr diagnostics or truncated evidence", () => {
  const fixture = { rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER" };
  assert.equal(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" },
    outcome: "success", stdout: "NESTED_MARKER", stderr: "ROOT_MARKER"
  }, fixture).verdict, "nested-only");
  assert.equal(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" },
    outcome: "success", stdout: "no markers", stderr: "ROOT_MARKER"
  }, fixture).verdict, "inconclusive");
  assert.equal(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" },
    outcome: "success", stdout: "x".repeat(12001) + "\nROOT_MARKER"
  }, fixture).verdict, "root-only");
  assert.deepEqual(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" },
    outcome: "nonzero_exit", stdout: "ROOT_MARKER NESTED_MARKER"
  }, fixture), { root: false, nested: false, verdict: "inconclusive" });
});

test("nested probe requires successful, non-empty CLI version evidence", () => {
  const fixture = { rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER" };
  const execution = { outcome: "success", stdout: "ROOT_MARKER NESTED_MARKER" };
  for (const outcome of ["not_found", "nonzero_exit", "timeout", "spawn_error", "signaled"]) {
    assert.deepEqual(classifyNestedEvidence({
      ...execution, version: { outcome, stdout: "agent 1.0" }
    }, fixture), { root: false, nested: false, verdict: "inconclusive" }, outcome);
  }
  for (const version of [
    undefined,
    { outcome: "success", stdout: "  ", stderr: "" }
  ]) {
    assert.equal(classifyNestedEvidence({ ...execution, version }, fixture).verdict, "inconclusive");
  }
  for (const version of [
    { outcome: "success", stdout: "agent 1.0", stderr: "" },
    { outcome: "success", stdout: "", stderr: "agent 1.0" }
  ]) {
    assert.equal(classifyNestedEvidence({ ...execution, version }, fixture).verdict, "root-and-nested");
  }
});

test("nested version probe redacts fixture markers in persisted diagnostics", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-version-mask-"));
  try {
    const fixture = createNestedInstructionFixture(temp, "codex");
    const script = path.join(temp, "mock-version.cjs");
    fs.writeFileSync(script,
      `process.stdout.write(${JSON.stringify(fixture.rootMarker)});\nprocess.stderr.write(${JSON.stringify(fixture.nestedMarker)});\n`);
    const record = runNestedVersionProbe(process.execPath, [script], { cwd: fixture.workspace, fixture });
    assert.equal(record.outcome, "success");
    assert.equal(record.stdout, "<ROOT_MARKER>");
    assert.equal(record.stderr, "<NESTED_MARKER>");
    for (const value of [record.command, record.stdout, record.stderr]) {
      assert.ok(!value.includes(fixture.rootMarker));
      assert.ok(!value.includes(fixture.nestedMarker));
    }
    assert.throws(() => runNestedVersionProbe(process.execPath, ["--version"], { cwd: fixture.workspace }),
      /requires fixture markers/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("nested fixture generates fresh challenge markers for each run", () => {
  const dirs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-nonce-")));
  try {
    const [first, second] = dirs.map((dir) => createNestedInstructionFixture(dir, "codex"));
    assert.match(first.rootMarker, /^CANIAGENT_ROOT_CODEX_[0-9A-F]{24}$/);
    assert.match(first.nestedMarker, /^CANIAGENT_NESTED_CODEX_[0-9A-F]{24}$/);
    assert.notEqual(first.rootMarker, second.rootMarker);
    assert.notEqual(first.nestedMarker, second.nestedMarker);
    assert.notEqual(first.fixtureSha256, second.fixtureSha256);
    assert.ok(fs.readFileSync(path.join(first.workspace, "AGENTS.md"), "utf8").includes(first.rootMarker));
    assert.ok(fs.readFileSync(path.join(first.nested, "AGENTS.md"), "utf8").includes(first.nestedMarker));
  } finally {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nested fixture digest covers the generated instruction and README bytes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-digest-"));
  try {
    const fixture = createNestedInstructionFixture(temp, "codex");
    const manifest = () => ({
      instructionFile: fixture.file,
      root: fs.readFileSync(path.join(fixture.workspace, fixture.file), "utf8"),
      nested: fs.readFileSync(path.join(fixture.nested, fixture.file), "utf8"),
      readme: fs.readFileSync(path.join(fixture.workspace, "README.md"), "utf8")
    });
    const digest = () => createHash("sha256").update(JSON.stringify(manifest())).digest("hex");
    assert.equal(fixture.fixtureSha256, digest());
    assert.ok(!fixture.fixtureSha256.includes(fixture.rootMarker));
    assert.ok(!fixture.fixtureSha256.includes(fixture.nestedMarker));
    fs.appendFileSync(path.join(fixture.nested, fixture.file), "modified\\n");
    assert.notEqual(fixture.fixtureSha256, digest());
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("nested markers require a clean terminal line, not CLI echoes or partial matches", () => {
  const fixture = { rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER" };
  for (const output of [
    "Instructions: ROOT_MARKER NESTED_MARKER",
    "ROOT_MARKER NESTED_MARKER\nno model answer",
    "ROOT_MARKER\nNESTED_MARKER",
    "ROOT_MARKER\rNESTED_MARKER",
    "ROOT_MARKER\u2028NESTED_MARKER",
    "ROOT_MARKER\u2029NESTED_MARKER",
    "ROOT_MARKER\vNESTED_MARKER",
    "ROOT_MARKER\fNESTED_MARKER",
    "ROOT_MARKER\rNESTED_MARKER\r",
    "ROOT_MARKER ROOT_MARKER",
    "ROOT_MARKER NESTED_MARKER extra",
    "prefix ROOT_MARKER",
    "ROOT_MARKER_NESTED_MARKER",
    "tool echoed ROOT_MARKER\nROOT_MARKER"
  ]) {
    assert.deepEqual(classifyNestedMarkers(output, fixture), {
      root: false, nested: false, verdict: "inconclusive"
    }, output);
  }
  assert.deepEqual(classifyNestedMarkers("CLI startup\r\n NESTED_MARKER ROOT_MARKER \r\n", fixture), {
    root: true, nested: true, verdict: "root-and-nested"
  });
  assert.equal(classifyNestedMarkers("CLI startup\nROOT_MARKER\n", fixture).verdict, "root-only");
  assert.equal(classifyNestedMarkers("CLI startup\r NESTED_MARKER ROOT_MARKER \r", fixture).verdict, "root-and-nested");
  assert.equal(classifyNestedMarkers("CLI startup\u2028NESTED_MARKER ROOT_MARKER\u2028", fixture).verdict, "root-and-nested");
});

test("nested challenge markers are masked in persisted command, stdout, stderr and errors", () => {
  const fixture = {
    rootMarker: "CANIAGENT_ROOT_CODEX_ABCDEF0123456789ABCDEF01",
    nestedMarker: "CANIAGENT_NESTED_CODEX_ABCDEF0123456789ABCDEF01"
  };
  const result = {
    status: 0,
    signal: null,
    stdout: `startup ${fixture.rootMarker}\n${fixture.nestedMarker}`,
    stderr: `diagnostic ${fixture.nestedMarker}`
  };
  const record = summarizeNestedExecution("mock-agent", ["--echo", fixture.rootMarker], result, fixture);
  assert.equal(record.outcome, "success");
  assert.equal(record.command, "mock-agent --echo <ROOT_MARKER>");
  assert.equal(record.stdout, "startup <ROOT_MARKER>\n<NESTED_MARKER>");
  assert.equal(record.stderr, "diagnostic <NESTED_MARKER>");
  for (const value of [record.command, record.stdout, record.stderr]) {
    assert.ok(!value.includes(fixture.rootMarker));
    assert.ok(!value.includes(fixture.nestedMarker));
  }
  // Only the original in-memory stdout is eligible for classification.
  assert.equal(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" }, outcome: record.outcome, stdout: fixture.nestedMarker }, fixture).verdict, "nested-only");
  assert.equal(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" }, outcome: record.outcome, stdout: record.stdout }, fixture).verdict, "inconclusive");

  const failure = summarizeNestedExecution("mock-agent", [], {
    status: null,
    signal: null,
    error: new Error(`failed near ${fixture.rootMarker}`)
  }, fixture);
  assert.equal(failure.outcome, "spawn_error");
  assert.equal(failure.error, "failed near <ROOT_MARKER>");
});

test("nested probe retains final marker after more than 1 MiB of stdout", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-large-"));
  try {
    const script = path.join(dir, "large-output.cjs");
    fs.writeFileSync(script, 'process.stdout.write("x".repeat(1_100_000) + "\\nROOT_MARKER");\n');
    const { record, rawStdout } = runNestedProbe(process.execPath, [script], { cwd: dir });
    assert.equal(record.outcome, "success");
    assert.equal(record.status, 0);
    assert.equal(record.stdout.length, 12000);
    assert.equal(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" }, outcome: record.outcome, stdout: rawStdout }, {
      rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER"
    }).verdict, "root-only");
    assert.equal(record.stdout.includes("ROOT_MARKER"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nested probe buffer overflow fails closed rather than accepting partial stdout", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-overflow-"));
  try {
    const script = path.join(dir, "overflow.cjs");
    fs.writeFileSync(script,
      'process.stdout.write("x".repeat(8 * 1024 * 1024 + 1024) + "\\nROOT_MARKER");\n');
    const { record, rawStdout } = runNestedProbe(process.execPath, [script], { cwd: dir });
    assert.equal(record.outcome, "spawn_error");
    assert.match(record.error ?? "", /ENOBUFS/);
    assert.ok(record.stdout.length <= 12000);
    assert.deepEqual(classifyNestedEvidence({ version: { outcome: "success", stdout: "agent 1.0" }, outcome: record.outcome, stdout: rawStdout }, {
      rootMarker: "ROOT_MARKER", nestedMarker: "NESTED_MARKER"
    }), { root: false, nested: false, verdict: "inconclusive" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

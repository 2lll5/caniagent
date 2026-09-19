import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMatrix } from "../src/core.js";
import { scanRepository, compatibilityFindings } from "../src/detect.js";

test("scanner finds common coding-agent files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-"));
  fs.mkdirSync(path.join(dir, ".claude", "skills", "ship"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# agent rules");
  fs.writeFileSync(path.join(dir, ".claude", "skills", "ship", "SKILL.md"), "---\nname: ship\n---");
  fs.writeFileSync(path.join(dir, ".mcp.json"), "{}");

  const found = scanRepository(dir);
  assert.ok(found.some((item) => item.path === "AGENTS.md"));
  assert.ok(found.some((item) => item.path.endsWith("SKILL.md")));
  assert.ok(found.some((item) => item.path === ".mcp.json"));
});

test("scanner does not misclassify generic agent config as project instructions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-config-"));
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".gemini"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".codex", "config.toml"), "model = \"example\"");
  fs.writeFileSync(path.join(dir, ".gemini", "settings.json"), "{}");
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{}");
  fs.writeFileSync(path.join(dir, "opencode.json"), "{}");

  assert.deepEqual(scanRepository(dir), []);
});

test("scanner classifies nested instruction files separately", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-nested-"));
  fs.mkdirSync(path.join(dir, "packages", "api"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# root rules");
  fs.writeFileSync(path.join(dir, "packages", "api", "AGENTS.md"), "# scoped rules");

  const found = scanRepository(dir);
  assert.deepEqual(found.map(({ path: file, feature }) => ({ path: file, feature })), [
    { path: "AGENTS.md", feature: "project-instructions" },
    { path: "packages/api/AGENTS.md", feature: "nested-instructions" }
  ]);

  const findings = compatibilityFindings(loadMatrix(), found, "codex");
  const nested = findings.find((item) => item.featureId === "nested-instructions");
  assert.deepEqual(nested?.detected, ["packages/api/AGENTS.md"]);
  assert.equal(nested?.nativeCount, 1);
});

test("scanner finds deeply nested instruction files by default", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-deep-default-"));
  const segments = Array.from({ length: 10 }, (_, index) => `level-${index + 1}`);
  const nested = path.join(dir, ...segments);
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "AGENTS.md"), "# deeply scoped agent rules");

  assert.deepEqual(scanRepository(dir).map((item) => item.path), [
    `${segments.join("/")}/AGENTS.md`
  ]);
});

test("scanner does not treat differently-cased paths as documented conventions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-case-"));
  fs.mkdirSync(path.join(dir, ".CLAUDE", "skills", "ship"), { recursive: true });
  fs.writeFileSync(path.join(dir, "agents.md"), "# not AGENTS.md");
  fs.writeFileSync(path.join(dir, ".CLAUDE", "skills", "ship", "skill.md"), "---\nname: ship\n---");
  fs.writeFileSync(path.join(dir, ".MCP.json"), "{}");

  assert.deepEqual(scanRepository(dir), []);
});

test("scanner skips Python virtual environments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-venv-"));
  for (const envName of [".venv", "venv"]) {
    const deep = path.join(dir, envName, "lib", "python", "site-packages", "one", "two", "three", "four");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "AGENTS.md"), "# dependency fixture");
  }
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# project rules");

  assert.deepEqual(scanRepository(dir).map((item) => item.path), ["AGENTS.md"]);
});

test("scanner rejects a missing root instead of reporting an empty repository", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-missing-"));
  const missing = path.join(dir, "does-not-exist");
  assert.throws(() => scanRepository(missing), /Scan path does not exist:/);
});

test("scanner rejects a file root", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-file-"));
  const file = path.join(dir, "AGENTS.md");
  fs.writeFileSync(file, "# agent rules");
  assert.throws(() => scanRepository(file), /Scan path is not a directory:/);
});

test("scanner fails instead of returning partial results at the file limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-limit-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# agent rules");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# claude rules");

  assert.throws(
    () => scanRepository(dir, { maxFiles: 1 }),
    /Scan exceeded file limit \(1\) before the repository was fully inspected/
  );
});

test("scanner fails instead of returning partial results at the depth limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-depth-"));
  fs.mkdirSync(path.join(dir, "one", "two"), { recursive: true });
  fs.writeFileSync(path.join(dir, "one", "two", "AGENTS.md"), "# nested agent rules");

  assert.throws(
    () => scanRepository(dir, { maxDepth: 1 }),
    /Scan exceeded depth limit \(1\) before the repository was fully inspected/
  );
});

test("scanner fails instead of returning partial results when a directory cannot be read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-unreadable-"));
  const blocked = path.join(dir, "blocked");
  fs.mkdirSync(blocked);
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# agent rules");

  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = (target, options) => {
    if (path.resolve(target) === path.resolve(blocked)) {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    }
    return originalReaddirSync(target, options);
  };

  try {
    assert.throws(() => scanRepository(dir), /Cannot read scan directory: blocked \(EACCES\)/);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
});

test("compatibility findings flag foreign conventions", () => {
  const matrix = loadMatrix();
  const detections = [
    { path: "CLAUDE.md", feature: "project-instructions", native: ["claude-code"], label: "CLAUDE.md" }
  ];
  const findings = compatibilityFindings(matrix, detections, "codex");
  assert.deepEqual(findings[0].foreign, ["CLAUDE.md"]);
});

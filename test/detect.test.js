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

test("compatibility findings flag foreign conventions", () => {
  const matrix = loadMatrix();
  const detections = [
    { path: "CLAUDE.md", feature: "project-instructions", native: ["claude-code"], label: "CLAUDE.md" }
  ];
  const findings = compatibilityFindings(matrix, detections, "codex");
  assert.deepEqual(findings[0].foreign, ["CLAUDE.md"]);
});

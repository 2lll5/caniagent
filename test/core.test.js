import test from "node:test";
import assert from "node:assert/strict";
import { loadMatrix, getAgent, getFeature, featureRows, listCategories } from "../src/core.js";

const matrix = loadMatrix();

test("matrix loads with expected agents", () => {
  assert.deepEqual(matrix.agents.map((a) => a.id), ["codex", "claude-code", "gemini-cli", "opencode"]);
});

test("lookups return known entries", () => {
  assert.equal(getAgent(matrix, "codex").command, "codex");
  assert.equal(getFeature(matrix, "mcp").name, "MCP client");
});

test("feature filtering works", () => {
  assert.ok(featureRows(matrix, { category: "automation" }).every((row) => row.category === "automation"));
  assert.ok(featureRows(matrix, { query: "sandbox" }).some((row) => row.id === "sandbox"));
});

test("categories are stable and unique", () => {
  const categories = listCategories(matrix);
  assert.deepEqual(categories, [...new Set(categories)]);
  assert.ok(categories.includes("security"));
});

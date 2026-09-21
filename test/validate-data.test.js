import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const validator = fileURLToPath(new URL("../scripts/validate-data.js", import.meta.url));

function validate(evidence, { published = "same" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-validate-"));
  const matrix = {
    agents: [{ id: "test-agent" }],
    features: [{
      id: "test-feature",
      support: {
        "test-agent": {
          status: "yes",
          evidence: [evidence]
        }
      }
    }]
  };
  const matrixText = JSON.stringify(matrix);
  fs.mkdirSync(path.join(dir, "data"));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "data", "matrix.json"), matrixText);
  if (published === "same") {
    fs.writeFileSync(path.join(dir, "docs", "matrix.json"), matrixText);
  } else if (published === "different") {
    fs.writeFileSync(path.join(dir, "docs", "matrix.json"), `${matrixText}\n`);
  }
  return spawnSync(process.execPath, [validator], { cwd: dir, encoding: "utf8" });
}

const validEvidence = { type: "docs", url: "https://example.com/docs", checked: "2026-09-19" };

test("data validator accepts complete evidence metadata", () => {
  const result = validate(validEvidence);
  assert.equal(result.status, 0, result.stderr);
});

test("data validator rejects incomplete or malformed evidence metadata", () => {
  const result = validate({ type: "", url: "not-a-url", checked: "2026-02-30" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence 1 needs a type/);
  assert.match(result.stderr, /evidence 1 needs an http\(s\) URL/);
  assert.match(result.stderr, /evidence 1 needs a valid checked date \(YYYY-MM-DD\)/);
});

test("data validator rejects a missing published matrix", () => {
  const result = validate(validEvidence, { published: "missing" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/matrix\.json is missing; run npm run site:data/);
});

test("data validator rejects published matrix drift", () => {
  const result = validate(validEvidence, { published: "different" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/matrix\.json is out of sync with data\/matrix\.json; run npm run site:data/);
});

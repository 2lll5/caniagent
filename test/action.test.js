import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const action = fs.readFileSync(new URL("../action.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("passes Action inputs through environment variables instead of shell interpolation", () => {
  const runBlock = action.match(/      run: \|\n([\s\S]*?)(?=\n    - name: Upload SARIF)/)?.[1] ?? "";

  assert.match(action, /CANIAGENT_PATH: \$\{\{ inputs\.path \}\}/);
  assert.match(action, /CANIAGENT_AGENT: \$\{\{ inputs\.agent \}\}/);
  assert.doesNotMatch(runBlock, /\$\{\{\s*inputs\./);
  assert.match(runBlock, /check "\$CANIAGENT_PATH" --agent "\$CANIAGENT_AGENT"/);
});

test("validates upload-sarif instead of silently treating typos as false", () => {
  const validateBlock = action.match(/    - name: Validate inputs\n([\s\S]*?)(?=\n    - id: scan)/)?.[1] ?? "";

  assert.match(validateBlock, /CANIAGENT_UPLOAD_SARIF: \$\{\{ inputs\.upload-sarif \}\}/);
  assert.match(validateBlock, /true\|false\)/);
  assert.match(validateBlock, /upload-sarif must be 'true' or 'false'/);
});

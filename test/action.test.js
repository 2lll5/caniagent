import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const action = fs.readFileSync(new URL("../action.yml", import.meta.url), "utf8");

test("passes Action inputs through environment variables instead of shell interpolation", () => {
  const runBlock = action.match(/      run: \|\n([\s\S]*?)(?=\n    - name: Upload SARIF)/)?.[1] ?? "";

  assert.match(action, /CANIAGENT_PATH: \$\{\{ inputs\.path \}\}/);
  assert.match(action, /CANIAGENT_AGENT: \$\{\{ inputs\.agent \}\}/);
  assert.doesNotMatch(runBlock, /\$\{\{\s*inputs\./);
  assert.match(runBlock, /check "\$CANIAGENT_PATH" --agent "\$CANIAGENT_AGENT"/);
});

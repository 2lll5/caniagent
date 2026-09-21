import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const action = fs.readFileSync(new URL("../action.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("passes Action inputs through environment variables instead of shell interpolation", () => {
  const runBlock = action.match(/    - id: scan[\s\S]*?      run: \|\n([\s\S]*?)(?=\n    - name: Upload SARIF)/)?.[1] ?? "";

  assert.match(action, /CANIAGENT_PATH: \$\{\{ inputs\.path \}\}/);
  assert.match(action, /CANIAGENT_AGENT: \$\{\{ inputs\.agent \}\}/);
  assert.match(action, /CANIAGENT_FROM: \$\{\{ inputs\.from \}\}/);
  assert.doesNotMatch(runBlock, /\$\{\{\s*inputs\./);
  assert.match(runBlock, /args=\(check "\$CANIAGENT_PATH" --agent "\$CANIAGENT_AGENT" --format sarif --output "\$CANIAGENT_SARIF"\)/);
  assert.match(runBlock, /args\+=\(--from "\$CANIAGENT_FROM"\)/);
  assert.match(runBlock, /node "\$GITHUB_ACTION_PATH\/src\/cli\.js" "\$\{args\[@\]\}"/);
});

test("source-agent Action input is optional and defaults to unscoped checks", () => {
  assert.match(action, /  from:\n    description:[^\n]+\n    required: false\n    default: ""/);
  const runBlock = action.match(/    - id: scan[\s\S]*?      run: \|\n([\s\S]*?)(?=\n    - name: Upload SARIF)/)?.[1] ?? "";
  assert.match(runBlock, /if \[\[ -n "\$CANIAGENT_FROM" \]\]; then/);
});

test("validates upload-sarif instead of silently treating typos as false", () => {
  const validateBlock = action.match(/    - name: Validate inputs\n([\s\S]*?)(?=\n    - id: scan)/)?.[1] ?? "";

  assert.match(validateBlock, /CANIAGENT_UPLOAD_SARIF: \$\{\{ inputs\.upload-sarif \}\}/);
  assert.match(validateBlock, /true\|false\)/);
  assert.match(validateBlock, /upload-sarif must be 'true' or 'false'/);
});

function assertImmutableActionPins(source, label) {
  const uses = [...source.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)]
    .map((match) => match[1])
    .filter((dependency) => !dependency.startsWith("./"));

  assert.ok(uses.length > 0, `expected at least one external Action dependency in ${label}`);
  for (const dependency of uses) {
    assert.match(dependency, /@[0-9a-f]{40}$/i, `${dependency} in ${label} must use a full commit SHA`);
  }
}

test("pins third-party Action dependencies to immutable commits", () => {
  assertImmutableActionPins(action, "action.yml");
  assertImmutableActionPins(ci, ".github/workflows/ci.yml");
});

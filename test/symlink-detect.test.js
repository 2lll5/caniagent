import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner does not follow symbolic links outside the repository", (t) => {
  if (process.platform === "win32") {
    t.skip("Creating symlinks may require elevated privileges on Windows");
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-symlink-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-outside-"));
  fs.writeFileSync(path.join(outside, "AGENTS.md"), "# outside rules");
  fs.mkdirSync(path.join(outside, ".codex"));
  fs.writeFileSync(path.join(outside, ".codex", "config.toml"), "[mcp_servers.external]\ncommand = \"example\"\n");

  fs.symlinkSync(path.join(outside, "AGENTS.md"), path.join(dir, "AGENTS.md"));
  fs.symlinkSync(path.join(outside, ".codex"), path.join(dir, ".codex"), "dir");

  assert.deepEqual(scanRepository(dir), []);
});

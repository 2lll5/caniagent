import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Replacing a checked regular file with a FIFO can block a plain O_RDONLY open
// forever, before the descriptor-based type check gets a chance to reject it.
// Exercise the race in a subprocess so a regression times out instead of
// hanging the entire test suite. mkfifo is available on POSIX CI runners.
test("MCP evidence readers do not block when a checked file becomes a FIFO",
  { skip: process.platform === "win32" }, (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-mcp-fifo-"));
    try {
      const availability = path.join(temp, "mkfifo-availability");
      const tool = spawnSync("mkfifo", [availability], { encoding: "utf8" });
      if (tool.error?.code === "ENOENT") {
        t.skip("mkfifo unavailable");
        return;
      }
      assert.equal(tool.status, 0, tool.stderr || tool.error?.message);
      fs.unlinkSync(availability);

      const probeUrl = new URL("../scripts/probe-mcp.js", import.meta.url).href;
      const childSource = `
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { readMcpReceipt, readMcpInitialization } from ${JSON.stringify(probeUrl)};

const file = process.argv[1];
const kind = process.argv[2];
const originalLstat = fs.lstatSync;
fs.lstatSync = function (candidate, ...args) {
  const stat = originalLstat.call(this, candidate, ...args);
  if (candidate === file) {
    fs.unlinkSync(file);
    const created = spawnSync("mkfifo", [file], { encoding: "utf8" });
    if (created.status !== 0) throw new Error(created.stderr || created.error?.message);
  }
  return stat;
};
const value = kind === "receipt" ? readMcpReceipt(file) : readMcpInitialization(file);
console.log(JSON.stringify(value));
`;
      for (const [kind, data, expected] of [
        ["receipt", '{"name":"caniagent_echo","matched":true}\n', null],
        ["initialization", "initialized\n", false]
      ]) {
        const file = path.join(temp, kind);
        fs.writeFileSync(file, data);
        const child = spawnSync(process.execPath,
          ["--input-type=module", "-e", childSource, file, kind],
          { encoding: "utf8", timeout: 3000 });
        assert.equal(child.error, undefined, `${kind}: ${child.error?.message}`);
        assert.equal(child.status, 0, `${kind}: ${child.stderr}`);
        assert.deepEqual(JSON.parse(child.stdout), expected, kind);
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

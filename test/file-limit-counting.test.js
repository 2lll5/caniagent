import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepository } from "../src/detect.js";

test("scanner file limit counts files rather than directory entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caniagent-file-count-"));
  const nested = path.join(dir, "one", "two", "three");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "AGENTS.md"), "# nested rules");

  assert.deepEqual(scanRepository(dir, { maxFiles: 1 }).map((item) => item.path), [
    "one/two/three/AGENTS.md"
  ]);
});

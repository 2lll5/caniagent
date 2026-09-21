import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMatrix } from "../src/core.js";
import { classifyProbeExecution, redactAndTruncateProbeOutput, redactProbeOutput } from "./probe-utils.js";

export const SKILL_PROBE_SPECS = {
  codex: { projectPath: [".agents", "skills"], userPath: [".agents", "skills"], versionArgs: ["--version"], args: (prompt) => ["exec", "--ephemeral", prompt] },
  "claude-code": { projectPath: [".claude", "skills"], versionArgs: ["--version"], args: (prompt) => ["-p", prompt] },
  "gemini-cli": { projectPath: [".gemini", "skills"], userPath: [".gemini", "skills"], versionArgs: ["--version"], args: (prompt) => ["--approval-mode=yolo", "-p", prompt] },
  opencode: { projectPath: [".opencode", "skills"], userPath: [".config", "opencode", "skills"], versionArgs: ["--version"], args: (prompt) => ["run", prompt] }
};

export function createSkillFixture(baseDir, agentId, scope = "project") {
  const spec = SKILL_PROBE_SPECS[agentId];
  if (!spec) throw new Error(`No Agent Skills probe adapter for ${agentId}`);
  const scopePath = scope === "project" ? spec.projectPath : scope === "user" ? spec.userPath : undefined;
  if (!scopePath) throw new Error(`No ${scope}-scope Agent Skills discovery path for ${agentId}`);
  const suffix = `${agentId}-${scope}`.replaceAll("-", "_").toUpperCase();
  const marker = `CANIAGENT_SKILL_${suffix}`;
  const skillName = `caniagent-probe-${agentId}-${scope}`;
  const workspace = path.join(baseDir, "workspace");
  const root = scope === "project" ? workspace : path.join(baseDir, "home");
  const skillDir = path.join(root, ...scopePath, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), "# CanIAgent Agent Skills probe fixture\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    `name: ${skillName}`,
    "description: CanIAgent deterministic discovery probe. Use when explicitly asked to run the CanIAgent skill discovery probe.",
    "---",
    "",
    `When invoked for the CanIAgent skill discovery probe, reply with exactly: ${marker}`,
    ""
  ].join("\n"));
  const discoveryPath = scope === "project"
    ? path.relative(workspace, skillDir).split(path.sep).join("/") + "/"
    : `~/${[...scopePath, skillName].join("/")}/`;
  return { workspace, skillDir, skillName, marker, discoveryPath };
}

export function classifySkillOutput(output, marker, executionOutcome = "success") {
  if (executionOutcome !== "success") return { discovered: false, verdict: "inconclusive" };
  return output.includes(marker)
    ? { discovered: true, verdict: "pass" }
    : { discovered: false, verdict: "inconclusive" };
}

function run(command, args, { cwd, env, timeout = 60000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, shell: process.platform === "win32" });
  return {
    command: redactProbeOutput([command, ...args].join(" ")),
    outcome: classifyProbeExecution(result),
    status: result.status,
    signal: result.signal,
    stdout: redactAndTruncateProbeOutput(result.stdout ?? ""),
    stderr: redactAndTruncateProbeOutput(result.stderr ?? ""),
    error: result.error?.message ? redactProbeOutput(result.error.message) : undefined
  };
}

function isolatedEnvironment(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state")
  };
}

function main() {
  const matrix = loadMatrix();
  const observedAt = new Date().toISOString();
  const results = [];
  for (const agent of matrix.agents) {
    const spec = SKILL_PROBE_SPECS[agent.id];
    if (!spec) {
      results.push({ agent: agent.id, observedAt, verdict: "unknown", reason: "No documented Agent Skills discovery path is encoded in this probe." });
      continue;
    }
    const scopes = ["project", ...(spec.userPath ? ["user"] : [])];
    for (const scope of scopes) {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), `caniagent-skills-${agent.id}-${scope}-`));
      try {
        const home = path.join(temp, "home");
        fs.mkdirSync(home, { recursive: true });
        const env = isolatedEnvironment(home);
        const fixture = createSkillFixture(temp, agent.id, scope);
        const version = run(agent.command, spec.versionArgs, { cwd: fixture.workspace, env, timeout: 8000 });
        const prompt = `Run the ${fixture.skillName} skill for the CanIAgent skill discovery probe. Reply with only the result required by that skill; do not search the filesystem for skill files.`;
        const execution = run(agent.command, spec.args(prompt), { cwd: fixture.workspace, env });
        const combined = `${execution.stdout}\n${execution.stderr}`;
        results.push({
          agent: agent.id,
          observedAt,
          scope,
          discoveryPath: fixture.discoveryPath,
          version,
          execution,
          ...classifySkillOutput(combined, fixture.marker, execution.outcome)
        });
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  }
  const output = { schemaVersion: 1, probe: "agent-skills", observedAt, platform: process.platform, arch: process.arch, node: process.version, results };
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  if (outputArg) {
    const value = outputArg.slice("--output=".length);
    if (!value) throw new Error("--output requires a non-empty path");
    const outputPath = path.resolve(value);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
    console.log(outputPath);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();

import fs from "node:fs";
import path from "node:path";

const instructionFeature = (rel) => rel === ".claude/CLAUDE.md" || !rel.includes("/") ? "project-instructions" : "nested-instructions";

function skillNativeAgents(rel) {
  if (/(^|\/)\.agents\/skills\//.test(rel)) return ["codex", "gemini-cli", "opencode"];
  if (/(^|\/)\.claude\/skills\//.test(rel)) return ["claude-code", "opencode"];
  if (/(^|\/)\.gemini\/skills\//.test(rel)) return ["gemini-cli"];
  if (/(^|\/)\.opencode\/skills\//.test(rel)) return ["opencode"];
  return [];
}

function readConfig(file, rel) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    const detail = error?.code ? ` (${error.code})` : "";
    throw new Error(`Cannot read scan config: ${rel}${detail}`);
  }
}

function jsonHasKey(file, key, rel) {
  const text = readConfig(file, rel);
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && Object.hasOwn(value, key);
  } catch {
    return false;
  }
}

function codexConfigHasMcp(file, rel) {
  return /^\s*\[mcp_servers(?:\.|\])/m.test(readConfig(file, rel));
}

const RULES = [
  { match: (rel, name) => /^AGENTS\.md$/.test(name), feature: instructionFeature, native: ["codex", "opencode"], label: "AGENTS.md" },
  { match: (rel, name) => /^AGENTS\.override\.md$/.test(name), feature: instructionFeature, native: ["codex"], label: "AGENTS.override.md" },
  { match: (rel, name) => /^CLAUDE\.md$/.test(name), feature: instructionFeature, native: ["claude-code"], label: "CLAUDE.md" },
  { match: (rel, name) => /^GEMINI\.md$/.test(name), feature: instructionFeature, native: ["gemini-cli"], label: "GEMINI.md" },
  { match: (rel) => /(^|\/)\.mcp\.json$/.test(rel), feature: "mcp", native: ["claude-code"], label: ".mcp.json" },
  { match: (rel, name, full) => rel === ".codex/config.toml" && codexConfigHasMcp(full, rel), feature: "mcp", native: ["codex"], label: ".codex/config.toml" },
  { match: (rel, name, full) => rel === ".gemini/settings.json" && jsonHasKey(full, "mcpServers", rel), feature: "mcp", native: ["gemini-cli"], label: ".gemini/settings.json" },
  { match: (rel, name, full) => rel === "opencode.json" && jsonHasKey(full, "mcp", rel), feature: "mcp", native: ["opencode"], label: "opencode.json" },
  { match: (rel, name) => /^SKILL\.md$/.test(name) && /(^|\/)(\.agents|\.claude|\.gemini|\.opencode)\/skills\//.test(rel), feature: "skills", native: skillNativeAgents, label: "SKILL.md" }
];

const SKIP = new Set([".git", "node_modules", "vendor", "dist", "build", ".next", "target", ".venv", "venv"]);

export function scanRepository(root, { maxDepth = 32, maxFiles = 20000 } = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new TypeError("maxDepth must be a non-negative integer");
  if (!Number.isInteger(maxFiles) || maxFiles < 0) throw new TypeError("maxFiles must be a non-negative integer");

  const resolvedRoot = path.resolve(root);
  let rootStat;
  try {
    rootStat = fs.statSync(resolvedRoot);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Scan path does not exist: ${resolvedRoot}`);
    throw new Error(`Cannot access scan path: ${resolvedRoot}`);
  }
  if (!rootStat.isDirectory()) throw new Error(`Scan path is not a directory: ${resolvedRoot}`);

  const found = [];
  let visitedFiles = 0;
  let fileLimitExceeded = false;
  let depthLimitExceeded = false;

  function walk(dir, depth) {
    if (fileLimitExceeded || depthLimitExceeded) return;
    if (depth > maxDepth) {
      depthLimitExceeded = true;
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      const rel = path.relative(resolvedRoot, dir).replaceAll(path.sep, "/") || ".";
      const detail = error?.code ? ` (${error.code})` : "";
      throw new Error(`Cannot read scan directory: ${rel}${detail}`);
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(resolvedRoot, full).replaceAll(path.sep, "/");

      if (entry.isDirectory()) {
        walk(full, depth + 1);
        if (fileLimitExceeded || depthLimitExceeded) break;
        continue;
      }
      if (!entry.isFile()) continue;

      if (visitedFiles >= maxFiles) {
        fileLimitExceeded = true;
        break;
      }
      visitedFiles += 1;

      for (const rule of RULES) {
        if (rule.match(rel, entry.name, full)) {
          const feature = typeof rule.feature === "function" ? rule.feature(rel) : rule.feature;
          const native = typeof rule.native === "function" ? rule.native(rel) : rule.native;
          found.push({ path: rel, feature, native, label: rule.label });
          break;
        }
      }
    }
  }

  walk(resolvedRoot, 0);
  if (fileLimitExceeded) {
    throw new Error(`Scan exceeded file limit (${maxFiles}) before the repository was fully inspected`);
  }
  if (depthLimitExceeded) {
    throw new Error(`Scan exceeded depth limit (${maxDepth}) before the repository was fully inspected`);
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

export function compatibilityFindings(matrix, detections, targetAgentId) {
  const agent = matrix.agents.find((item) => item.id === targetAgentId);
  if (!agent) throw new Error(`Unknown agent: ${targetAgentId}`);

  const groups = new Map();
  for (const item of detections) {
    const key = item.feature;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const findings = [];
  for (const [featureId, items] of groups.entries()) {
    const feature = matrix.features.find((f) => f.id === featureId);
    const support = feature?.support?.[targetAgentId] ?? { status: "unknown", note: "No data" };
    const nativeCount = items.filter((item) => item.native.includes(targetAgentId)).length;
    const foreign = items.filter((item) => !item.native.includes(targetAgentId));

    findings.push({
      featureId,
      featureName: feature?.name ?? featureId,
      status: support.status,
      note: support.note,
      detected: items.map((item) => item.path),
      nativeCount,
      foreign: foreign.map((item) => item.path)
    });
  }

  return findings.sort((a, b) => a.featureName.localeCompare(b.featureName));
}

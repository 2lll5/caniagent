import fs from "node:fs";
import path from "node:path";

const RULES = [
  { match: (rel, name) => /^AGENTS\.md$/i.test(name), feature: "project-instructions", native: ["codex", "opencode"], label: "AGENTS.md" },
  { match: (rel, name) => /^AGENTS\.override\.md$/i.test(name), feature: "project-instructions", native: ["codex"], label: "AGENTS.override.md" },
  { match: (rel, name) => /^CLAUDE\.md$/i.test(name), feature: "project-instructions", native: ["claude-code"], label: "CLAUDE.md" },
  { match: (rel, name) => /^GEMINI\.md$/i.test(name), feature: "project-instructions", native: ["gemini-cli"], label: "GEMINI.md" },
  { match: (rel) => /(^|\/)\.mcp\.json$/i.test(rel), feature: "mcp", native: ["claude-code"], label: ".mcp.json" },
  { match: (rel) => /(^|\/)opencode\.jsonc?$/i.test(rel), feature: "project-instructions", native: ["opencode"], label: "OpenCode config" },
  { match: (rel) => /(^|\/)\.codex\/config\.toml$/i.test(rel), feature: "project-instructions", native: ["codex"], label: "Codex config" },
  { match: (rel) => /(^|\/)\.gemini\/settings\.json$/i.test(rel), feature: "project-instructions", native: ["gemini-cli"], label: "Gemini settings" },
  { match: (rel) => /(^|\/)\.claude\/settings(\.local)?\.json$/i.test(rel), feature: "project-instructions", native: ["claude-code"], label: "Claude settings" },
  { match: (rel, name) => /^SKILL\.md$/i.test(name) && /(^|\/)(\.agents|\.claude|\.opencode)\/skills\//i.test(rel), feature: "skills", native: ["codex", "claude-code", "opencode"], label: "SKILL.md" }
];

const SKIP = new Set([".git", "node_modules", "vendor", "dist", "build", ".next", "target"]);

export function scanRepository(root, { maxDepth = 6, maxFiles = 20000 } = {}) {
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
  let visited = 0;
  let fileLimitExceeded = false;
  let depthLimitExceeded = false;

  function walk(dir, depth) {
    if (depth > maxDepth) {
      depthLimitExceeded = true;
      return;
    }
    if (visited >= maxFiles) {
      fileLimitExceeded = true;
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
      if (visited >= maxFiles) {
        fileLimitExceeded = true;
        break;
      }
      visited += 1;
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(resolvedRoot, full).replaceAll(path.sep, "/");

      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }

      for (const rule of RULES) {
        if (rule.match(rel, entry.name)) {
          found.push({ path: rel, feature: rule.feature, native: rule.native, label: rule.label });
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

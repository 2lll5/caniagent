import path from "node:path";

const MCP_PROJECT_CONFIG = {
  codex: ".codex/config.toml",
  "claude-code": ".mcp.json",
  "gemini-cli": ".gemini/settings.json",
  opencode: "opencode.json"
};

export function migrationDetections(detections, sourceAgentId) {
  if (!sourceAgentId) return detections;
  return detections.filter((item) => item.native.includes(sourceAgentId));
}

function evidenceFor(feature, targetAgentId) {
  const support = feature?.support?.[targetAgentId];
  if (support?.status !== "yes" || !support.evidence?.some((entry) => entry.url)) return null;
  return {
    feature: feature.id,
    status: support.status,
    note: support.note,
    urls: support.evidence.map((entry) => entry.url).filter(Boolean)
  };
}

export function migrationSuggestions(matrix, detections, sourceAgentId, targetAgentId) {
  if (!sourceAgentId || !targetAgentId || sourceAgentId === targetAgentId) return [];
  const target = matrix.agents.find((agent) => agent.id === targetAgentId);
  const instructionFeature = matrix.features.find((item) => item.id === "project-instructions");
  const instructionEvidence = evidenceFor(instructionFeature, targetAgentId);
  const targetInstruction = target?.instructions?.[0];
  const suggestions = [];

  if (targetInstruction && instructionEvidence) {
    suggestions.push(...detections
      .filter((item) => ["project-instructions", "nested-instructions"].includes(item.feature))
      .filter((item) => item.native.includes(sourceAgentId) && !item.native.includes(targetAgentId))
      .map((item) => {
        const directory = path.posix.dirname(item.path);
        const targetPath = item.feature === "project-instructions"
          ? targetInstruction
          : path.posix.join(directory, targetInstruction);
        return {
          kind: "instruction-file",
          from: item.path,
          to: targetPath,
          targetAgent: targetAgentId,
          evidence: instructionEvidence
        };
      })
      .filter((suggestion) => suggestion.from !== suggestion.to));
  }

  const mcpFeature = matrix.features.find((item) => item.id === "mcp");
  const mcpEvidence = evidenceFor(mcpFeature, targetAgentId);
  const targetMcpConfig = MCP_PROJECT_CONFIG[targetAgentId];
  if (targetMcpConfig && mcpEvidence) {
    suggestions.push(...detections
      .filter((item) => item.feature === "mcp")
      .filter((item) => item.native.includes(sourceAgentId) && !item.native.includes(targetAgentId))
      .map((item) => ({
        kind: "mcp-config",
        from: item.path,
        to: targetMcpConfig,
        targetAgent: targetAgentId,
        evidence: mcpEvidence
      }))
      .filter((suggestion) => suggestion.from !== suggestion.to));
  }

  return suggestions;
}

import path from "node:path";

export function migrationDetections(detections, sourceAgentId) {
  if (!sourceAgentId) return detections;
  return detections.filter((item) => item.native.includes(sourceAgentId));
}

export function migrationSuggestions(matrix, detections, sourceAgentId, targetAgentId) {
  if (!sourceAgentId || !targetAgentId) return [];
  const target = matrix.agents.find((agent) => agent.id === targetAgentId);
  const feature = matrix.features.find((item) => item.id === "project-instructions");
  const support = feature?.support?.[targetAgentId];
  const targetInstruction = target?.instructions?.[0];
  if (!targetInstruction || support?.status !== "yes") return [];

  return detections
    .filter((item) => ["project-instructions", "nested-instructions"].includes(item.feature))
    .filter((item) => item.native.includes(sourceAgentId) && !item.native.includes(targetAgentId))
    .map((item) => {
      const directory = path.posix.dirname(item.path);
      const targetPath = directory === "." ? targetInstruction : path.posix.join(directory, targetInstruction);
      return {
        kind: "instruction-file",
        from: item.path,
        to: targetPath,
        targetAgent: targetAgentId,
        evidence: {
          feature: "project-instructions",
          status: support.status,
          note: support.note,
          urls: (support.evidence ?? []).map((entry) => entry.url).filter(Boolean)
        }
      };
    })
    .filter((suggestion) => suggestion.from !== suggestion.to);
}

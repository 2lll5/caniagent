export function migrationDetections(detections, sourceAgentId) {
  if (!sourceAgentId) return detections;
  return detections.filter((item) => item.native.includes(sourceAgentId));
}

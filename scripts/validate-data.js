import fs from "node:fs";
import path from "node:path";

const file = path.resolve("data/matrix.json");
const matrix = JSON.parse(fs.readFileSync(file, "utf8"));
const validStatuses = new Set(["yes", "partial", "experimental", "unknown", "no"]);
const agentIds = new Set();
const featureIds = new Set();
const errors = [];

for (const agent of matrix.agents ?? []) {
  if (!agent.id) errors.push("agent missing id");
  if (agentIds.has(agent.id)) errors.push(`duplicate agent id: ${agent.id}`);
  agentIds.add(agent.id);
}

for (const feature of matrix.features ?? []) {
  if (!feature.id) errors.push("feature missing id");
  if (featureIds.has(feature.id)) errors.push(`duplicate feature id: ${feature.id}`);
  featureIds.add(feature.id);

  for (const agent of matrix.agents ?? []) {
    const cell = feature.support?.[agent.id];
    if (!cell) errors.push(`${feature.id}: missing support cell for ${agent.id}`);
    else if (!validStatuses.has(cell.status)) errors.push(`${feature.id}/${agent.id}: invalid status ${cell.status}`);
    if (cell?.status !== "unknown" && !(cell?.evidence?.length)) {
      errors.push(`${feature.id}/${agent.id}: non-unknown cell needs evidence`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`matrix valid: ${matrix.agents.length} agents × ${matrix.features.length} features`);

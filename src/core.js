import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultMatrixPath = path.resolve(here, "../data/matrix.json");
const packagePath = path.resolve(here, "../package.json");
export const packageVersion = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;

export function loadMatrix(file = defaultMatrixPath) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function getAgent(matrix, id) {
  return matrix.agents.find((agent) => agent.id === id);
}

export function getFeature(matrix, id) {
  return matrix.features.find((feature) => feature.id === id);
}

export function listCategories(matrix) {
  return [...new Set(matrix.features.map((feature) => feature.category))].sort();
}

export function featureRows(matrix, { category, query } = {}) {
  let rows = matrix.features;
  if (category) rows = rows.filter((row) => row.category === category);
  if (query) {
    const q = query.toLowerCase();
    rows = rows.filter((row) =>
      [row.id, row.name, row.category, row.description].some((value) =>
        String(value).toLowerCase().includes(q)
      )
    );
  }
  return rows;
}

export function statusScore(status) {
  return { yes: 4, partial: 3, experimental: 2, unknown: 1, no: 0 }[status] ?? -1;
}

export function compareAgents(matrix, agentIds) {
  const agents = agentIds.map((id) => getAgent(matrix, id)).filter(Boolean);
  return matrix.features.map((feature) => ({
    id: feature.id,
    name: feature.name,
    category: feature.category,
    cells: agents.map((agent) => ({
      agent: agent.id,
      status: feature.support[agent.id]?.status ?? "unknown",
      note: feature.support[agent.id]?.note ?? "No data"
    }))
  }));
}

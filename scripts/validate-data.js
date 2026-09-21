import fs from "node:fs";
import path from "node:path";

const file = path.resolve("data/matrix.json");
const publishedFile = path.resolve("docs/matrix.json");
const sourceText = fs.readFileSync(file, "utf8");
const matrix = JSON.parse(sourceText);
const validStatuses = new Set(["yes", "partial", "experimental", "unknown", "no"]);
const agentIds = new Set();
const featureIds = new Set();
const errors = [];

function isValidCheckedDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

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
    for (const [index, evidence] of (cell?.evidence ?? []).entries()) {
      const prefix = `${feature.id}/${agent.id}: evidence ${index + 1}`;
      if (!evidence?.type || typeof evidence.type !== "string") errors.push(`${prefix} needs a type`);
      if (!isHttpUrl(evidence?.url)) errors.push(`${prefix} needs an http(s) URL`);
      if (!isValidCheckedDate(evidence?.checked)) errors.push(`${prefix} needs a valid checked date (YYYY-MM-DD)`);
    }
  }
}

if (!fs.existsSync(publishedFile)) {
  errors.push("docs/matrix.json is missing; run npm run site:data");
} else {
  const publishedText = fs.readFileSync(publishedFile, "utf8");
  if (publishedText !== sourceText) {
    errors.push("docs/matrix.json is out of sync with data/matrix.json; run npm run site:data");
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`matrix valid: ${matrix.agents.length} agents × ${matrix.features.length} features; published copy synchronized`);

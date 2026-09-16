const ICON = { yes: "✅", partial: "🟡", experimental: "🧪", unknown: "❔", no: "❌" };

export function icon(status) {
  return ICON[status] ?? "·";
}

export function pad(value, width) {
  const text = String(value);
  return text + " ".repeat(Math.max(0, width - [...text].length));
}

export function renderMatrix(matrix, rows = matrix.features) {
  const agents = matrix.agents;
  const first = Math.max(18, ...rows.map((row) => row.name.length));
  const agentWidths = agents.map((agent) => Math.max(12, agent.name.length));
  const header = [
    pad("Feature", first),
    ...agents.map((agent, i) => pad(agent.name, agentWidths[i]))
  ].join("  ");
  const line = "-".repeat([...header].length);
  const body = rows.map((row) =>
    [
      pad(row.name, first),
      ...agents.map((agent, i) => {
        const status = row.support[agent.id]?.status ?? "unknown";
        return pad(`${icon(status)} ${status}`, agentWidths[i]);
      })
    ].join("  ")
  );
  return [header, line, ...body].join("\n");
}

export function renderFindings(agentName, findings) {
  if (!findings.length) return `No recognized agent configuration found for ${agentName}.`;
  const lines = [`Compatibility check for ${agentName}`, ""];
  for (const item of findings) {
    lines.push(`${icon(item.status)} ${item.featureName}: ${item.status}`);
    lines.push(`   ${item.note}`);
    lines.push(`   detected: ${item.detected.join(", ")}`);
    if (item.foreign.length) lines.push(`   migration attention: ${item.foreign.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

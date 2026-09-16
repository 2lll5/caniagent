#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { loadMatrix, getAgent, getFeature, featureRows, listCategories } from "./core.js";
import { scanRepository, compatibilityFindings } from "./detect.js";
import { renderMatrix, renderFindings, icon } from "./format.js";

const VERSION = "0.1.0";
const matrix = loadMatrix();

function usage() {
  console.log(`CanIAgent ${VERSION}

Usage:
  caniagent matrix [--category <name>] [--search <text>] [--json]
  caniagent feature <feature-id> [--json]
  caniagent agent <agent-id> [--json]
  caniagent check [path] --agent <agent-id> [--json]
  caniagent categories
  caniagent agents
  caniagent --version
  caniagent --help

Examples:
  caniagent matrix
  caniagent feature mcp
  caniagent check . --agent codex
  caniagent check . --agent claude-code --json
`);
}

function valueOf(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args, name) {
  return args.includes(name);
}

function json(value) {
  console.log(JSON.stringify(value, null, 2));
}

const args = process.argv.slice(2);
if (args.length === 0 || has(args, "--help") || has(args, "-h")) {
  usage();
  process.exit(0);
}
if (has(args, "--version") || has(args, "-v")) {
  console.log(VERSION);
  process.exit(0);
}

const [command, ...rest] = args;

try {
  if (command === "matrix") {
    const rows = featureRows(matrix, {
      category: valueOf(rest, "--category"),
      query: valueOf(rest, "--search")
    });
    if (has(rest, "--json")) json({ updatedAt: matrix.updatedAt, agents: matrix.agents, features: rows });
    else {
      console.log(`CanIAgent compatibility matrix · data ${matrix.updatedAt}\n`);
      console.log(renderMatrix(matrix, rows));
      console.log("\nLegend: ✅ yes  🟡 partial  🧪 experimental  ❔ unknown  ❌ no");
    }
  } else if (command === "feature") {
    const id = rest.find((arg) => !arg.startsWith("-"));
    const feature = getFeature(matrix, id);
    if (!feature) throw new Error(`Unknown feature: ${id ?? "(missing)"}`);
    if (has(rest, "--json")) json(feature);
    else {
      console.log(`${feature.name} (${feature.id})`);
      console.log(feature.description);
      console.log("");
      for (const agent of matrix.agents) {
        const support = feature.support[agent.id] ?? { status: "unknown", note: "No data", evidence: [] };
        console.log(`${icon(support.status)} ${agent.name}: ${support.status}`);
        console.log(`   ${support.note}`);
        if (support.evidence?.[0]?.url) console.log(`   ${support.evidence[0].url}`);
      }
    }
  } else if (command === "agent") {
    const id = rest.find((arg) => !arg.startsWith("-"));
    const agent = getAgent(matrix, id);
    if (!agent) throw new Error(`Unknown agent: ${id ?? "(missing)"}`);
    const support = matrix.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      category: feature.category,
      ...(feature.support[id] ?? { status: "unknown", note: "No data" })
    }));
    if (has(rest, "--json")) json({ ...agent, support });
    else {
      console.log(`${agent.name} (${agent.id})`);
      console.log(agent.homepage);
      console.log(`Install: ${agent.install}\n`);
      for (const row of support) console.log(`${icon(row.status)} ${row.name}: ${row.status}`);
    }
  } else if (command === "check") {
    const target = valueOf(rest, "--agent");
    if (!target) throw new Error("check requires --agent <agent-id>");
    const agent = getAgent(matrix, target);
    if (!agent) throw new Error(`Unknown agent: ${target}`);
    const positional = rest.filter((arg, i) => !arg.startsWith("-") && rest[i - 1] !== "--agent");
    const targetPath = path.resolve(positional[0] ?? ".");
    const detections = scanRepository(targetPath);
    const findings = compatibilityFindings(matrix, detections, target);
    if (has(rest, "--json")) json({ path: targetPath, target: agent, detections, findings });
    else console.log(renderFindings(agent.name, findings));
  } else if (command === "categories") {
    for (const category of listCategories(matrix)) console.log(category);
  } else if (command === "agents") {
    for (const agent of matrix.agents) console.log(`${agent.id}\t${agent.name}`);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`caniagent: ${error.message}`);
  process.exitCode = 1;
}

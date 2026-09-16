#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { loadMatrix, getAgent, getFeature, featureRows, listCategories } from "./core.js";
import { scanRepository, compatibilityFindings } from "./detect.js";
import { renderMatrix, renderFindings, icon } from "./format.js";
import { buildSarif } from "./sarif.js";

const VERSION = "0.2.0";
const matrix = loadMatrix();

function usage() {
  console.log(`CanIAgent ${VERSION}

Usage:
  caniagent matrix [--category <name>] [--search <text>] [--json]
  caniagent feature <feature-id> [--json]
  caniagent agent <agent-id> [--json]
  caniagent check [path] --agent <agent-id> [--format text|json|sarif] [--output <file>]
  caniagent categories
  caniagent agents
  caniagent --version
  caniagent --help

Examples:
  caniagent matrix
  caniagent feature mcp
  caniagent check . --agent codex
  caniagent check . --agent claude-code --format json
  caniagent check . --agent codex --format sarif --output caniagent.sarif
`);
}

function valueOf(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(args, name) {
  return args.includes(name);
}

function positionalArgs(args, optionsWithValues = []) {
  const options = new Set(optionsWithValues);
  const result = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (options.has(arg)) {
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) result.push(arg);
  }
  return result;
}

function stringify(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function emit(text, outputPath) {
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, text);
    return;
  }
  process.stdout.write(text);
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
    if (has(rest, "--json")) emit(stringify({ updatedAt: matrix.updatedAt, agents: matrix.agents, features: rows }));
    else {
      console.log(`CanIAgent compatibility matrix · data ${matrix.updatedAt}\n`);
      console.log(renderMatrix(matrix, rows));
      console.log("\nLegend: ✅ yes  🟡 partial  🧪 experimental  ❔ unknown  ❌ no");
    }
  } else if (command === "feature") {
    const id = positionalArgs(rest)[0];
    const feature = getFeature(matrix, id);
    if (!feature) throw new Error(`Unknown feature: ${id ?? "(missing)"}`);
    if (has(rest, "--json")) emit(stringify(feature));
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
    const id = positionalArgs(rest)[0];
    const agent = getAgent(matrix, id);
    if (!agent) throw new Error(`Unknown agent: ${id ?? "(missing)"}`);
    const support = matrix.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      category: feature.category,
      ...(feature.support[id] ?? { status: "unknown", note: "No data" })
    }));
    if (has(rest, "--json")) emit(stringify({ ...agent, support }));
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
    const targetPath = path.resolve(positionalArgs(rest, ["--agent", "--format", "--output"])[0] ?? ".");
    const detections = scanRepository(targetPath);
    const findings = compatibilityFindings(matrix, detections, target);
    const format = has(rest, "--json") ? "json" : (valueOf(rest, "--format") ?? "text");
    const outputPath = valueOf(rest, "--output");

    if (!new Set(["text", "json", "sarif"]).has(format)) {
      throw new Error(`Unsupported format: ${format}`);
    }

    if (format === "json") {
      emit(stringify({ path: targetPath, target: agent, detections, findings }), outputPath);
    } else if (format === "sarif") {
      emit(stringify(buildSarif({ matrix, targetAgent: agent, root: targetPath, findings })), outputPath);
    } else {
      emit(renderFindings(agent.name, findings) + "\n", outputPath);
    }
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

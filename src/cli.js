#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import path from "node:path";
import { loadMatrix, getAgent, getFeature, featureRows, listCategories, packageVersion } from "./core.js";
import { scanRepository, compatibilityFindings } from "./detect.js";
import { renderMatrix, renderFindings, icon } from "./format.js";
import { migrationDetections, migrationSuggestions } from "./migration.js";
import { buildSarif } from "./sarif.js";

const VERSION = packageVersion;
const matrix = loadMatrix();

function usage() {
  console.log(`CanIAgent ${VERSION}\n\nUsage:\n  caniagent matrix [--category <name>] [--search <text>] [--json]\n  caniagent feature <feature-id> [--json]\n  caniagent agent <agent-id> [--json]\n  caniagent check [path] [--from <agent-id>] --agent <agent-id> [--format text|json|sarif] [--output <file>] [--fail-on none|warning|error]\n  caniagent categories\n  caniagent agents\n  caniagent --version\n  caniagent --help\n\nExamples:\n  caniagent matrix\n  caniagent feature mcp\n  caniagent check . --agent codex\n  caniagent check . --from claude-code --agent codex\n  caniagent check . --agent claude-code --format json\n  caniagent check . --agent codex --format sarif --output caniagent.sarif\n`);
}

function valueOf(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value`);
  return value;
}

function has(args, name) { return args.includes(name); }

function hasInfoFlag(args, flags) {
  const valuedOptions = new Set(["--category", "--search", "--agent", "--from", "--format", "--output", "--fail-on"]);
  for (let i = 0; i < args.length; i += 1) {
    if (valuedOptions.has(args[i])) { i += 1; continue; }
    if (flags.includes(args[i])) return true;
  }
  return false;
}

function validateOptions(args, allowed) {
  const allowedSet = new Set(allowed);
  const seen = new Set();
  for (const arg of args) {
    if (!arg.startsWith("-")) continue;
    if (!allowedSet.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
  }
}

function positionalArgs(args, optionsWithValues = []) {
  const options = new Set(optionsWithValues);
  const result = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (options.has(arg)) { i += 1; continue; }
    if (!arg.startsWith("-")) result.push(arg);
  }
  return result;
}

function validatePositionals(args, optionsWithValues = [], max = 0) {
  const positionals = positionalArgs(args, optionsWithValues);
  if (positionals.length > max) throw new Error(`Unexpected argument: ${positionals[max]}`);
  return positionals;
}

function stringify(value) { return JSON.stringify(value, null, 2) + "\n"; }

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
if (args.length === 0 || hasInfoFlag(args, ["--help", "-h"])) { usage(); process.exit(0); }
if (hasInfoFlag(args, ["--version", "-v"])) { console.log(VERSION); process.exit(0); }
const [command, ...rest] = args;

try {
  if (command === "matrix") {
    validateOptions(rest, ["--category", "--search", "--json"]);
    validatePositionals(rest, ["--category", "--search"]);
    const rows = featureRows(matrix, { category: valueOf(rest, "--category"), query: valueOf(rest, "--search") });
    if (has(rest, "--json")) emit(stringify({ updatedAt: matrix.updatedAt, agents: matrix.agents, features: rows }));
    else {
      console.log(`CanIAgent compatibility matrix · data ${matrix.updatedAt}\n`);
      console.log(renderMatrix(matrix, rows));
      console.log("\nLegend: ✅ yes  🟡 partial  🧪 experimental  ❔ unknown  ❌ no");
    }
  } else if (command === "feature") {
    validateOptions(rest, ["--json"]);
    const id = validatePositionals(rest, [], 1)[0];
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
    validateOptions(rest, ["--json"]);
    const id = validatePositionals(rest, [], 1)[0];
    const agent = getAgent(matrix, id);
    if (!agent) throw new Error(`Unknown agent: ${id ?? "(missing)"}`);
    const support = matrix.features.map((feature) => ({ id: feature.id, name: feature.name, category: feature.category, ...(feature.support[id] ?? { status: "unknown", note: "No data" }) }));
    if (has(rest, "--json")) emit(stringify({ ...agent, support }));
    else {
      console.log(`${agent.name} (${agent.id})`);
      console.log(agent.homepage);
      console.log(`Install: ${agent.install}\n`);
      for (const row of support) console.log(`${icon(row.status)} ${row.name}: ${row.status}`);
    }
  } else if (command === "check") {
    validateOptions(rest, ["--agent", "--from", "--format", "--output", "--fail-on", "--json"]);
    if (has(rest, "--json") && has(rest, "--format")) throw new Error("--json cannot be combined with --format");
    const target = valueOf(rest, "--agent");
    if (!target) throw new Error("check requires --agent <agent-id>");
    const agent = getAgent(matrix, target);
    if (!agent) throw new Error(`Unknown agent: ${target}`);
    const source = valueOf(rest, "--from");
    const sourceAgent = source ? getAgent(matrix, source) : undefined;
    if (source && !sourceAgent) throw new Error(`Unknown source agent: ${source}`);
    if (source && source === target) throw new Error("--from must differ from --agent");
    const format = has(rest, "--json") ? "json" : (valueOf(rest, "--format") ?? "text");
    const outputPath = valueOf(rest, "--output");
    if (!new Set(["text", "json", "sarif"]).has(format)) throw new Error(`Unsupported format: ${format}`);
    const failOn = valueOf(rest, "--fail-on") ?? "none";
    if (!["none", "warning", "error"].includes(failOn)) throw new Error(`Unsupported failure threshold: ${failOn}; use none, warning, or error`);
    const targetPath = path.resolve(validatePositionals(rest, ["--agent", "--from", "--format", "--output", "--fail-on"], 1)[0] ?? ".");
    const detections = migrationDetections(scanRepository(targetPath), source);
    const findings = compatibilityFindings(matrix, detections, target);
    const suggestions = migrationSuggestions(matrix, detections, source, target);
    const sarif = buildSarif({ matrix, targetAgent: agent, root: targetPath, findings, suggestions });

    if (format === "json") emit(stringify({ path: targetPath, source: sourceAgent ?? null, target: agent, detections, findings, suggestions }), outputPath);
    else if (format === "sarif") emit(stringify(sarif), outputPath);
    else {
      let text = sourceAgent ? `Migration: ${sourceAgent.name} → ${agent.name}\n` : "";
      text += renderFindings(agent.name, findings) + "\n";
      if (suggestions.length) {
        text += "\nSuggested file translations:\n";
        for (const suggestion of suggestions) text += `  ${suggestion.from} → ${suggestion.to}\n`;
      }
      emit(text, outputPath);
    }
    const failureLevels = { none: [], warning: ["warning", "error"], error: ["error"] }[failOn];
    if (sarif.runs.some((run) => run.results.some((result) => failureLevels.includes(result.level)))) {
      console.error(`caniagent: compatibility findings meet --fail-on ${failOn}`);
      process.exitCode = 2;
    }
  } else if (command === "categories") {
    validateOptions(rest, []); validatePositionals(rest);
    for (const category of listCategories(matrix)) console.log(category);
  } else if (command === "agents") {
    validateOptions(rest, []); validatePositionals(rest);
    for (const agent of matrix.agents) console.log(`${agent.id}\t${agent.name}`);
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`caniagent: ${error.message}`);
  process.exitCode = 1;
}

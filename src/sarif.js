import path from "node:path";
import { pathToFileURL } from "node:url";
import { packageVersion } from "./core.js";

const LEVEL = {
  no: "error",
  unknown: "note",
  experimental: "note",
  partial: "warning",
  yes: "warning"
};

function uriFor(relativePath) {
  return String(relativePath)
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function rootUri(root) {
  const resolved = path.resolve(root);
  const withSeparator = resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
  return pathToFileURL(withSeparator).href;
}

function ruleId(featureId, kind) {
  return `caniagent/${featureId}/${kind}`;
}

export function buildSarif({ matrix, targetAgent, root, findings, suggestions = [] }) {
  const rules = new Map();
  const results = [];
  const suggestionBySource = new Map(suggestions.map((suggestion) => [suggestion.from, suggestion]));

  function addRule(id, name, description, defaultLevel = "warning") {
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        name,
        shortDescription: { text: description },
        defaultConfiguration: { level: defaultLevel }
      });
    }
  }

  function addResult({ id, level, message, file }) {
    results.push({
      ruleId: id,
      level,
      message: { text: message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: uriFor(file), uriBaseId: "%SRCROOT%" },
            region: { startLine: 1 }
          }
        }
      ]
    });
  }

  for (const finding of findings) {
    const foreignId = ruleId(finding.featureId, "foreign-convention");
    if (finding.foreign.length) {
      addRule(
        foreignId,
        `${finding.featureId}-foreign-convention`,
        `${finding.featureName}: configuration convention may need migration`
      );
      for (const file of finding.foreign) {
        const suggestion = suggestionBySource.get(file);
        const migrationHint = suggestion ? ` Suggested target destination: ${suggestion.to}.` : "";
        addResult({
          id: foreignId,
          level: "warning",
          file,
          message: `${file} is not a native ${targetAgent.name} convention. Target support for ${finding.featureName}: ${finding.status}. ${finding.note}${migrationHint}`
        });
      }
    }

    if (["partial", "experimental", "unknown", "no"].includes(finding.status)) {
      const supportId = ruleId(finding.featureId, `support-${finding.status}`);
      addRule(
        supportId,
        `${finding.featureId}-support-${finding.status}`,
        `${finding.featureName}: target support is ${finding.status}`,
        LEVEL[finding.status] ?? "note"
      );
      for (const file of finding.detected) {
        addResult({
          id: supportId,
          level: LEVEL[finding.status] ?? "note",
          file,
          message: `${targetAgent.name} support for ${finding.featureName} is ${finding.status}. ${finding.note}`
        });
      }
    }
  }

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "CanIAgent",
            informationUri: matrix.project?.repository ?? "https://github.com/2lll5/caniagent",
            semanticVersion: packageVersion,
            rules: [...rules.values()]
          }
        },
        automationDetails: { id: `caniagent/${targetAgent.id}` },
        originalUriBaseIds: {
          "%SRCROOT%": { uri: rootUri(root) }
        },
        results
      }
    ]
  };
}

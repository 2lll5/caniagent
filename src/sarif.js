const LEVEL = {
  no: "error",
  unknown: "note",
  experimental: "note",
  partial: "warning",
  yes: "warning"
};

function uriFor(relativePath) {
  return encodeURI(String(relativePath).replaceAll("\\", "/"));
}

function ruleId(featureId, kind) {
  return `caniagent/${featureId}/${kind}`;
}

export function buildSarif({ matrix, targetAgent, root, findings }) {
  const rules = new Map();
  const results = [];

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
        addResult({
          id: foreignId,
          level: "warning",
          file,
          message: `${file} is not a native ${targetAgent.name} convention. Target support for ${finding.featureName}: ${finding.status}. ${finding.note}`
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
            semanticVersion: "0.2.0",
            rules: [...rules.values()]
          }
        },
        automationDetails: { id: `caniagent/${targetAgent.id}` },
        originalUriBaseIds: {
          "%SRCROOT%": { uri: `file://${String(root).replaceAll("\\", "/").replace(/\/$/, "")}/` }
        },
        results
      }
    ]
  };
}

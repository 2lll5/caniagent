import test from "node:test";
import assert from "node:assert/strict";
import { migrationDetections, migrationSuggestions } from "../src/migration.js";

test("filters detections to conventions native to the source agent", () => {
  const detections = [
    { path: "CLAUDE.md", native: ["claude-code"] },
    { path: "AGENTS.md", native: ["codex", "opencode"] },
    { path: ".claude/skills/demo/SKILL.md", native: ["claude-code", "opencode"] }
  ];

  assert.deepEqual(
    migrationDetections(detections, "claude-code").map((item) => item.path),
    ["CLAUDE.md", ".claude/skills/demo/SKILL.md"]
  );
});

test("leaves detections unchanged when no source agent is requested", () => {
  const detections = [{ path: "AGENTS.md", native: ["codex"] }];
  assert.equal(migrationDetections(detections), detections);
});

test("suggests instruction filenames only when target support is evidence-backed", () => {
  const matrix = {
    agents: [
      { id: "codex", instructions: ["AGENTS.md"] },
      { id: "claude-code", instructions: ["CLAUDE.md"] }
    ],
    features: [{
      id: "project-instructions",
      support: {
        codex: { status: "yes", note: "Uses AGENTS.md", evidence: [{ url: "https://example.test/codex" }] }
      }
    }, {
      id: "nested-instructions",
      support: {
        codex: { status: "yes", note: "Uses scoped AGENTS.md", evidence: [{ url: "https://example.test/codex-nested" }] }
      }
    }]
  };
  const detections = [
    { path: "CLAUDE.md", feature: "project-instructions", native: ["claude-code"] },
    { path: "packages/api/CLAUDE.md", feature: "nested-instructions", native: ["claude-code"] },
    { path: ".claude/skills/demo/SKILL.md", feature: "skills", native: ["claude-code"] }
  ];

  assert.deepEqual(
    migrationSuggestions(matrix, detections, "claude-code", "codex").map(({ from, to }) => ({ from, to })),
    [
      { from: "CLAUDE.md", to: "AGENTS.md" },
      { from: "packages/api/CLAUDE.md", to: "packages/api/AGENTS.md" }
    ]
  );
  assert.deepEqual(migrationSuggestions(matrix, detections, "claude-code", "claude-code"), []);
});

test("does not suggest translating Codex override instructions as ordinary instructions", () => {
  const matrix = {
    agents: [{ id: "claude-code", instructions: ["CLAUDE.md"] }],
    features: [{
      id: "project-instructions",
      support: {
        "claude-code": { status: "yes", note: "Uses CLAUDE.md", evidence: [{ url: "https://example.test/claude" }] }
      }
    }]
  };
  const detections = [{
    path: "AGENTS.override.md",
    feature: "project-instructions",
    native: ["codex"],
    label: "AGENTS.override.md"
  }];

  assert.deepEqual(migrationSuggestions(matrix, detections, "codex", "claude-code"), []);
});

test("does not suggest translations for unverified target instruction support", () => {
  const matrix = {
    agents: [{ id: "target", instructions: ["TARGET.md"] }],
    features: [{ id: "project-instructions", support: { target: { status: "unknown", evidence: [] } } }]
  };
  const detections = [{ path: "SOURCE.md", feature: "project-instructions", native: ["source"] }];
  assert.deepEqual(migrationSuggestions(matrix, detections, "source", "target"), []);
});

test("nested translations require evidence for nested support independently of project support", () => {
  const detection = { path: "nested/SOURCE.md", feature: "nested-instructions", native: ["source"] };
  const nestedEvidence = [{ url: "https://example.test/nested" }];
  const matrix = {
    agents: [{ id: "target", instructions: ["TARGET.md"] }],
    features: [
      { id: "project-instructions", support: { target: { status: "yes", evidence: [{ url: "https://example.test/root" }] } } },
      { id: "nested-instructions", support: { target: { status: "yes", evidence: nestedEvidence } } }
    ]
  };
  const [suggestion] = migrationSuggestions(matrix, [detection], "source", "target");
  assert.equal(suggestion.evidence.feature, "nested-instructions");
  assert.deepEqual(suggestion.evidence.urls, [nestedEvidence[0].url]);

  for (const support of [undefined, { status: "partial", evidence: nestedEvidence }, { status: "unknown", evidence: [] }, { status: "yes", evidence: [] }]) {
    matrix.features[1].support.target = support;
    assert.deepEqual(migrationSuggestions(matrix, [detection], "source", "target"), []);
  }
});

test("suggests documented project MCP config destinations", () => {
  const matrix = {
    agents: [{ id: "gemini-cli", instructions: ["GEMINI.md"] }],
    features: [{
      id: "mcp",
      support: {
        "gemini-cli": {
          status: "yes",
          note: "Gemini CLI configures MCP servers in settings.json.",
          evidence: [{ url: "https://example.test/gemini-mcp" }]
        }
      }
    }]
  };
  const detections = [{ path: ".mcp.json", feature: "mcp", native: ["claude-code"] }];
  const suggestions = migrationSuggestions(matrix, detections, "claude-code", "gemini-cli");

  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0], {
    kind: "mcp-config",
    from: ".mcp.json",
    to: ".gemini/settings.json",
    targetAgent: "gemini-cli",
    evidence: {
      feature: "mcp",
      status: "yes",
      note: "Gemini CLI configures MCP servers in settings.json.",
      urls: ["https://example.test/gemini-mcp"]
    }
  });
});

test("does not suggest MCP config without documented yes support and URL evidence", () => {
  const detections = [{ path: ".mcp.json", feature: "mcp", native: ["claude-code"] }];
  for (const support of [
    { status: "unknown", evidence: [] },
    { status: "yes", evidence: [] }
  ]) {
    const matrix = {
      agents: [{ id: "gemini-cli", instructions: ["GEMINI.md"] }],
      features: [{ id: "mcp", support: { "gemini-cli": support } }]
    };
    assert.deepEqual(migrationSuggestions(matrix, detections, "claude-code", "gemini-cli"), []);
  }
});

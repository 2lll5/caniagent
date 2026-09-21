# Source-agent migration checks

Use `check --from` when a repository contains conventions for more than one coding agent and you want migration findings scoped to the agent you are leaving:

```bash
node src/cli.js check . --from claude-code --agent codex
node src/cli.js check . --from claude-code --agent codex --format json
node src/cli.js check . --from claude-code --agent codex --format sarif --output caniagent.sarif
```

Without `--from`, `check` keeps its existing behavior and evaluates every compatibility-relevant surface it detects.

With `--from <agent-id>`, CanIAgent first keeps only detected files whose convention is native to that source agent, then evaluates those detections against the target supplied by `--agent`. This avoids unrelated files for other agents becoming migration noise in mixed-agent repositories. Shared conventions remain in scope when the source agent is one of their native agents.

## Suggested instruction-file translations

Migration mode suggests target instruction filenames when the matrix has documented `yes` support with URL evidence for the target's project-instruction convention. For example, migrating Claude Code to Codex can suggest `CLAUDE.md → AGENTS.md`; a nested `packages/api/CLAUDE.md` becomes `packages/api/AGENTS.md` so the repository-relative scope is preserved.

## Suggested MCP config destinations

When migration mode detects a source-native MCP config that is foreign to the target, it can suggest the target's documented project configuration destination. For example, Claude Code's `.mcp.json` can map to Gemini CLI's `.gemini/settings.json`. The suggestion is a destination hint only: MCP configuration schemas differ between agents, so CanIAgent does not claim the source file can be copied verbatim or automatically rewrite server definitions.

MCP hints are emitted only when the target's MCP matrix entry is documented `yes` and contains URL evidence. The currently recognized project destinations are `.codex/config.toml`, `.mcp.json`, `.gemini/settings.json`, and `opencode.json`; they correspond to the project configuration conventions documented by each agent's MCP/configuration guidance.

Suggestions are advisory: CanIAgent does not rename, copy, or rewrite files. Each JSON suggestion includes the matrix evidence note and source URLs used to justify the target convention. It deliberately emits no suggestion for `unknown`, `partial`, or undocumented target support. Skills translations remain intentionally unsuggested where path/scope semantics need more specific evidence.

The JSON report includes a `source` agent object when migration mode is active (`null` otherwise) and a `suggestions` array. SARIF keeps the same compatibility diagnostics and rule IDs; when an existing foreign-convention diagnostic has a matching evidence-backed migration suggestion, its message also includes the suggested target destination. Suggestions do not create additional diagnostics by themselves, so GitHub code scanning receives the same finding count while exposing the migration guidance produced by the CLI. `--from` must name a known agent and must differ from `--agent`.

This remains a scanner and advisory migration report, not an automatic translator. It does not infer undocumented support or change `data/matrix.json`.

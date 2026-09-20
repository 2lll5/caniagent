# Roadmap

CanIAgent is intentionally small at v0.1: a trustworthy data model, useful CLI, repo scanner, static comparison site, tests, and a probe harness.

## v0.2 — behavior probes

- Nested instruction precedence fixtures for all four agents.
- MCP stdio echo-server probe.
- Skill discovery fixture.
- Structured-output contract probe.
- Resume/session probe.
- Cross-platform GitHub Actions probe runners where authentication-free behavior permits it.

## v0.3 — migration intelligence

SARIF output and a reusable GitHub Action shipped in v0.2.

- `caniagent check --from claude-code --agent codex` — shipped; scopes findings to conventions native to the source agent.
- Suggested instruction-file translations — shipped for evidence-backed project/nested instruction conventions.
- Suggested MCP project-config destinations — shipped for evidence-backed target MCP support; schema rewriting remains out of scope.
- Suggested config hints for other agent-specific settings.

## v0.4 — ecosystem

- Community adapter API.
- Version-range assertions, not only "current".
- Historical compatibility snapshots.
- Badges: "Works with Codex", "Works with Claude Code", etc.
- Public JSON endpoint from GitHub Pages.

## Non-goals

- Ranking which coding agent is "best".
- Vendor marketing scores.
- Treating undocumented behavior as a stable contract.

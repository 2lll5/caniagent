# Roadmap

CanIAgent is intentionally small at v0.1: a trustworthy data model, useful CLI, repo scanner, static comparison site, tests, and a probe harness.

## v0.2 — behavior probes

The probe harnesses below are shipped. A shipped harness does **not** mean every compatibility claim has been behavior-verified: provider-backed runs still need reproducible evidence before matrix statuses change. Open probe issues track the remaining evidence work.

- Nested instruction precedence fixture — harness shipped for all four agents; reproducible provider-backed evidence is still tracked in issue #2.
- MCP stdio echo-server probe — shipped.
- Skill discovery fixture — harness shipped for Codex, Claude Code, Gemini CLI, and OpenCode; remaining behavior evidence is tracked in issue #4.
- Structured-output contract probe — shipped.
- Resume/session probe — shipped.
- Cross-platform GitHub Actions probe runners where authentication-free behavior permits it — pending.

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

# Agent Skills discovery probe

`scripts/probe-skills.js` is an opt-in behavior probe for project-scoped `SKILL.md` discovery. It is intentionally separate from the normal scanner and CI because invoking installed agents can require credentials and consume provider quota.

Run it with:

```sh
npm run probe:skills -- --output=artifacts/skills-probe.json
```

## What it tests

For each agent with a documented project-scope skill path encoded by CanIAgent, the probe creates a temporary workspace containing one uniquely named skill. The marker expected from that skill appears only in `SKILL.md`; the prompt names the skill but does not reveal the marker and tells the agent not to search the filesystem for skill files.

The current adapters cover the documented project paths already recognized by the scanner:

- Codex: `.agents/skills/<name>/SKILL.md`
- Claude Code: `.claude/skills/<name>/SKILL.md`
- OpenCode: `.opencode/skills/<name>/SKILL.md`

Gemini CLI remains `unknown`: CanIAgent does not encode a project-scope `SKILL.md` discovery path without current evidence. This probe must not be used to infer unsupported behavior from an adapter that does not exist.

## Isolation and evidence

Each run redirects `HOME`, `USERPROFILE`, and XDG config/data/state directories into a temporary directory, then removes the fixture. It records the agent version, OS/platform metadata, exact redacted command, exit status, redacted/truncated stdout and stderr, scope, and exact discovery path.

A marker observed after a successful execution is `pass`. Missing markers, authentication failures, timeouts, non-zero exits, and other execution problems are `inconclusive`; absence is not treated as evidence of unsupported behavior.

The probe currently tests project scope only. User/global scope should be added only when its fixture can be isolated without reading or modifying real user configuration.

Do not update `data/matrix.json` from a single ad-hoc run. Preserve the probe artifact with agent versions and reproduce the result before changing compatibility evidence, per `METHODOLOGY.md`.

# Agent Skills discovery probe

`scripts/probe-skills.js` is an opt-in behavior probe for `SKILL.md` discovery. It is intentionally separate from the normal scanner and CI because invoking installed agents can require credentials and consume provider quota.

Run it with:

```sh
npm run probe:skills -- --output=artifacts/skills-probe.json
```

## What it tests

For each agent and scope with a documented skill path encoded by CanIAgent, the probe creates a temporary workspace and/or isolated home containing one uniquely named skill. The marker expected from that skill appears only in `SKILL.md`; the prompt names the skill but does not reveal the marker and tells the agent not to search the filesystem for skill files.

The current adapters cover these documented paths:

| Agent | Project scope | User scope |
| --- | --- | --- |
| Codex | `.agents/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` |
| Claude Code | `.claude/skills/<name>/SKILL.md` | not encoded yet |
| Gemini CLI | `.gemini/skills/<name>/SKILL.md` | `~/.gemini/skills/<name>/SKILL.md` |
| OpenCode | `.opencode/skills/<name>/SKILL.md` | `~/.config/opencode/skills/<name>/SKILL.md` |

Gemini CLI now documents Agent Skills discovery at both `.gemini/skills/` and the interoperable `.agents/skills/` alias for workspace and user scopes. The probe uses the Gemini-native `.gemini/skills/` path and `--approval-mode=yolo` so the documented activation-consent step can complete in non-interactive `-p` mode. This flag is confined to the temporary probe workspace and isolated home.

The Codex user path is documented by OpenAI's Agent Skills documentation. OpenCode documents both its native global config path and compatibility paths; this probe uses the native `~/.config/opencode/skills` path. Claude Code user scope is deliberately not guessed here until its current path is independently evidenced for this probe. Missing adapters must not be interpreted as unsupported behavior.

## Isolation and evidence

Each run redirects `HOME`, `USERPROFILE`, and XDG config/data/state directories into a temporary directory. User-scope fixtures are created only below that isolated home, never below the real user home. The entire temporary fixture is removed after each scope run.

Each result records the agent version, OS/platform metadata, exact redacted command, exit status, redacted/truncated stdout and stderr, scope, and exact discovery path. Project and user scopes run independently so one successful discovery cannot satisfy another scope's evidence.

A marker observed after a successful execution is `pass`. Missing markers, authentication failures, timeouts, non-zero exits, and other execution problems are `inconclusive`; absence is not treated as evidence of unsupported behavior.

Do not update `data/matrix.json` from documentation alone or a single ad-hoc run. Preserve the probe artifact with agent versions and reproduce the result before changing compatibility evidence, per `METHODOLOGY.md`.

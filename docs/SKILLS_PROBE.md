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
| Claude Code | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| Gemini CLI | `.gemini/skills/<name>/SKILL.md` | `~/.gemini/skills/<name>/SKILL.md` |
| OpenCode | `.opencode/skills/<name>/SKILL.md` | `~/.config/opencode/skills/<name>/SKILL.md` |

Gemini CLI now documents Agent Skills discovery at both `.gemini/skills/` and the interoperable `.agents/skills/` alias for workspace and user scopes. The probe uses the Gemini-native `.gemini/skills/` path and `--approval-mode=yolo` so the documented activation-consent step can complete in non-interactive `-p` mode. This flag bypasses normal approval prompts; a temporary workspace and redirected configuration paths are **not** an execution sandbox. Run the opt-in probe only with trusted fixtures and appropriate external execution controls.

The Codex skill probe runs in a temporary workspace without a `.git` directory, so its `codex exec` adapter passes `--skip-git-repo-check` for both scopes. This flag is restricted to the opt-in probe invocation and does not change normal Codex project settings.

The Codex user path is documented by OpenAI's Agent Skills documentation. OpenCode documents both its native global config path and compatibility paths; this probe uses the native `~/.config/opencode/skills` path. Claude Code documents personal skills under `~/.claude/skills/<name>/SKILL.md` ([official Skills documentation](https://code.claude.com/docs/en/skills#choose-where-skills-load)). The probe tests this path only under its redirected temporary `HOME` and `CLAUDE_CONFIG_DIR`; adding a fixture is not provider-backed compatibility evidence. Missing adapters must not be interpreted as unsupported behavior.

## Isolation and evidence

Each run redirects `HOME`, `USERPROFILE`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, Windows `APPDATA`/`LOCALAPPDATA`, and XDG config/data/state/cache directories into a temporary home. Inherited `NODE_OPTIONS` (including case variants) is removed to avoid Node.js preload hooks changing CLI behavior. User-scope fixtures are created under the temporary home, and the fixture is removed after each scope run.

This environment redirection reduces accidental reuse of normal agent configuration; it does **not** guarantee that an agent cannot read or write files outside the fixture. Other environment variables, including credentials, proxies, and `NODE_EXTRA_CA_CERTS`, remain inherited, while enterprise integrations that require `NODE_OPTIONS` may behave differently. Use an external sandbox if stronger isolation is required.

Each result records the agent version, OS/platform metadata, exact redacted command, exit status, redacted/truncated stdout and stderr, scope, and exact discovery path. Project and user scopes run independently so one successful discovery cannot satisfy another scope's evidence.

The verdict examines the complete, original **stdout** in memory before evidence redaction and truncation. Only redacted/truncated stdout and stderr are serialized; a marker appearing **only in stderr diagnostics** cannot produce `pass`. This avoids false negatives when a valid marker appears beyond the 12,000-character evidence limit, without retaining raw output in artifacts.

A marker counts as `pass` only when the **last non-empty stdout line** matches the marker exactly after a successful execution (surrounding whitespace is allowed). Substrings embedded in echoed `SKILL.md` instructions, tool diagnostics, or other text remain `inconclusive`; a marker echoed earlier followed by a different final response is also `inconclusive`. A tool could still echo the marker as the final line, so this is **provisional discovery evidence**, not proof of skill activation or final-model-response provenance. Missing markers, authentication failures, timeouts, non-zero exits, and other execution problems are `inconclusive`; absence is not treated as evidence of unsupported behavior.

Do not update `data/matrix.json` from documentation alone or a single ad-hoc run. Preserve the probe artifact with agent versions and reproduce the result before changing compatibility evidence, per `METHODOLOGY.md`.

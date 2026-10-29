# Agent Skills discovery probe

`scripts/probe-skills.js` is an opt-in behavior probe for `SKILL.md` discovery. It is intentionally separate from the normal scanner and CI because invoking installed agents can require credentials and consume provider quota.

Run it with:

```sh
npm run probe:skills -- --output=artifacts/skills-probe.json
```

## What it tests

For each agent and scope with a documented skill path encoded by CanIAgent, the probe creates a temporary workspace and/or isolated home containing one uniquely named skill. The expected marker is a fresh 128-bit random challenge for each fixture, present only in `SKILL.md`; it cannot be reconstructed from the predictable agent/scope skill name. The prompt names the skill but does not reveal the marker and tells the agent not to search the filesystem for skill files. This reduces false positives from a model guessing the old deterministic marker without loading the skill, but still does not independently prove skill activation.

The current adapters cover these documented paths:

| Agent | Project scope | User scope |
| --- | --- | --- |
| Codex | `.agents/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` |
| Claude Code | `.claude/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |
| Gemini CLI | `.gemini/skills/<name>/SKILL.md` | `~/.gemini/skills/<name>/SKILL.md` |
| OpenCode | `.opencode/skills/<name>/SKILL.md` | `~/.config/opencode/skills/<name>/SKILL.md` |

Gemini CLI now documents Agent Skills discovery at both `.gemini/skills/` and the interoperable `.agents/skills/` alias for workspace and user scopes. The probe uses the Gemini-native `.gemini/skills/` path and `--approval-mode=yolo` so the documented activation-consent step can complete in non-interactive `-p` mode. This flag bypasses normal approval prompts; a temporary workspace and redirected configuration paths are **not** an execution sandbox. Run the opt-in probe only with trusted fixtures and appropriate external execution controls.

The Codex skill probe runs in a temporary workspace without a `.git` directory, so its `codex exec` adapter passes `--skip-git-repo-check` for both scopes. This flag is restricted to the opt-in probe invocation and does not change normal Codex project settings. The adapter also uses `--json` to inspect the Codex JSONL event stream rather than treating an arbitrary final stdout line as the model answer.

The Codex user path is documented by OpenAI's Agent Skills documentation. OpenCode documents both its native global config path and compatibility paths; this probe uses the native `~/.config/opencode/skills` path. Claude Code documents personal skills under `~/.claude/skills/<name>/SKILL.md` ([official Skills documentation](https://code.claude.com/docs/en/skills#choose-where-skills-load)). The probe tests this path only under its redirected temporary `HOME` and `CLAUDE_CONFIG_DIR`; adding a fixture is not provider-backed compatibility evidence. Missing adapters must not be interpreted as unsupported behavior.

## Isolation and evidence

Each run redirects `HOME`, `USERPROFILE`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, Windows `APPDATA`/`LOCALAPPDATA`, and XDG config/data/state/cache directories into a temporary home. Inherited `NODE_OPTIONS` (including case variants) is removed to avoid Node.js preload hooks changing CLI behavior. User-scope fixtures are created under the temporary home, and the fixture is removed after each scope run.

This environment redirection reduces accidental reuse of normal agent configuration; it does **not** guarantee that an agent cannot read or write files outside the fixture. Other environment variables, including credentials, proxies, and `NODE_EXTRA_CA_CERTS`, remain inherited, while enterprise integrations that require `NODE_OPTIONS` may behave differently. Use an external sandbox if stronger isolation is required.

Each result records the agent version, OS/platform metadata, exact redacted command, exit status, redacted/truncated stdout and stderr, scope, exact discovery path, and `fixtureSha256` (SHA-256 of the JSON manifest `{ discoveryPath, readme, skill }`, using the fixture README and `SKILL.md` text). The digest allows a captured fixture to be integrity-checked without persisting the random challenge in the report; it does not by itself prove skill activation or permit reconstruction of a deleted fixture. Project and user scopes run independently so one successful discovery cannot satisfy another scope's evidence.

The child-process capture has a bounded 8 MiB buffer rather than Node.js's default 1 MiB, so long but successful output can still be classified. Buffer overflow remains a subprocess error and therefore `inconclusive`; the full capture is never persisted.

The verdict examines the complete, original **stdout** in memory before evidence redaction and truncation. Only redacted/truncated stdout and stderr are serialized; a marker appearing **only in stderr diagnostics** cannot produce `pass`. The per-fixture random challenge is replaced with `<SKILL_MARKER>` in serialized command, stdout, stderr, and error text **before** truncation, without changing classification of the raw in-memory stdout. This avoids false negatives when a valid marker appears beyond the 12,000-character evidence limit, without retaining raw output in artifacts.

For **Claude Code**, the probe requests `--output-format json` and accepts a marker only from a successful top-level `type: "result"` envelope whose `result` text matches exactly. Markers in tool output, prompt echoes, metadata, malformed JSON, or error results remain `inconclusive`.

For **Gemini CLI**, the probe also requests `--output-format json`, using the documented headless `response` field as the final model answer ([official headless reference](https://geminicli.com/docs/cli/headless/)). A non-null `error`, `is_error`, malformed JSON, an unexpected event type, or a marker only in tool diagnostics cannot produce `pass`. Older Gemini CLI releases may not recognize `--output-format`; those runs remain `inconclusive` rather than falling back to an unverified text heuristic.

For **Codex**, the probe requests `codex exec --json` and parses its JSONL events. A provisional `pass` requires the last event to be `turn.completed`, immediately preceded by an `item.completed` `agent_message` whose text exactly matches the marker, after a `turn.started`. Malformed streams, failed turns, `item.failed` events, completed tool items with failed/declined status, non-zero command exit codes, MCP tool errors, error events, stale messages, unfinished tool invocations (tracked by item ID), and tool activity after the model reply remain `inconclusive`. This deliberately rejects ambiguous event sequences rather than guessing. The adapter follows the same JSONL event conventions used by the Structured Output Probe, but does not require that separate stacked PR to merge first.

For **OpenCode**, the probe requests `opencode run --format json` and reads the JSONL stream. Only a model `text` event with `part.type: "text"` can establish the final marker; a later tool call or other nonterminal event, a newer step without a reply, explicit errors (including tool states marked `error`/`failed`/`declined`, a non-null tool error payload, or a nonzero tool metadata exit code), mixed or contradictory session IDs, incomplete tool states (missing status, unresolved `pending`/`running` updates matched by `callID`), a non-`stop` terminal finish, or malformed JSONL remains `inconclusive`. A valid preceding `step_start` is required, and text after an already-finished step without a new start is rejected as stale evidence. OpenCode v2 may omit its final `step_finish`, so an absent finish is not by itself a failure. The marker must match model text exactly; the probe does not fall back to the last stdout line.

These structured verdicts verify the CLI's reported final model response, **not** independently that the skill was activated. Missing markers, authentication failures, timeouts, non-zero exits, and other execution problems are `inconclusive`; absence is not treated as evidence of unsupported behavior.

Do not update `data/matrix.json` from documentation alone or a single ad-hoc run. Preserve the probe artifact with agent versions and reproduce the result before changing compatibility evidence, per `METHODOLOGY.md`.

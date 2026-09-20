# Nested instruction behavior probe

`node scripts/probe-nested.js` is an opt-in behavior probe for roadmap issue #2. It creates a temporary repository for each supported agent, writes unique root and nested instruction markers using that agent's documented instruction filename, runs the agent from the nested directory, and records which markers appear.

Use `node scripts/probe-nested.js --output=.caniagent/nested-probe.json` to keep the JSON result. The probe uses documented non-interactive entry points: `codex exec --ephemeral`, `claude -p`, `gemini -p`, and `opencode run`.

The probe replaces `HOME`, `USERPROFILE`, and XDG config/data/state locations with a temporary directory and deletes the fixture afterward. This prevents the probe from writing to normal user configuration directories. Consequently, saved CLI login state is intentionally not reused; environment-based credentials may still be used by an agent. Running the probe can contact model providers and consume quota when credentials are available.

A successful process with neither marker is recorded as `inconclusive`, not as evidence that nested instructions are unsupported. Non-zero exits, missing CLIs, timeouts, and signals are also inconclusive. Probe output is redacted with the shared probe redactor before it is stored.

Do not promote a matrix status from a single local run. Record the agent version, platform, and reproducible result before changing compatibility evidence, per `METHODOLOGY.md`.

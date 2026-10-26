# Nested instruction behavior probe

`npm run probe:nested` is an opt-in behavior probe for roadmap issue #2. It creates a temporary repository for each supported agent, writes unique root and nested instruction markers using that agent's documented instruction filename, runs the agent from the nested directory, and records which markers appear.

Use `npm run probe:nested -- --output=.caniagent/nested-probe.json` to keep the JSON result. The probe uses documented non-interactive entry points: `codex exec --ephemeral`, `claude -p`, `gemini -p`, and `opencode run`. Each result also records a redacted `--version` execution so behavior evidence can be tied to the installed agent version without relying on a separately run probe.

The probe creates a temporary workspace and redirects `HOME`, `USERPROFILE`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, Windows `APPDATA`/`LOCALAPPDATA`, and XDG config/data/state/cache paths into its temporary home. It also removes inherited `NODE_OPTIONS` (including case variants) so Node.js preload hooks do not alter CLI behavior. This reduces accidental reuse of developer configuration and sessions, but **is not a filesystem or process sandbox**: an agent may still access external paths through other inherited settings or its own behavior. The fixture is deleted afterward.

Other environment variables, including authentication, proxy settings, and `NODE_EXTRA_CA_CERTS`, remain inherited. Saved CLI login state in the normal home is generally not reused; environment-based credentials may still be used. Removing `NODE_OPTIONS` can affect agents that depend on enterprise preload hooks. Running the probe can contact model providers and consume quota when credentials are available.

A successful process with neither marker is recorded as `inconclusive`, not as evidence that nested instructions are unsupported. Non-zero exits, missing CLIs, timeouts, and signals are also inconclusive. Probe output, including version output, is redacted with the shared probe redactor before it is stored.

Do not promote a matrix status from a single local run. Record the agent version, platform, and reproducible result before changing compatibility evidence, per `METHODOLOGY.md`.

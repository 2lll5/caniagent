<div align="center">

# CanIAgent

**Can I use this with my coding agent?**

An evidence-first compatibility matrix and repository scanner for **OpenAI Codex, Claude Code, Gemini CLI, and OpenCode**.

[![CI](https://github.com/2lll5/caniagent/actions/workflows/ci.yml/badge.svg)](https://github.com/2lll5/caniagent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)

</div>

Coding agents increasingly share concepts—project instructions, skills, MCP, hooks, headless mode—but the names, file locations and guarantees differ. CanIAgent puts those differences in one queryable dataset and can scan a repository before you switch agents.

> **Principle:** unknown is better than guessed. Every non-unknown compatibility claim should carry evidence.

## Quick start

No install is required:

```bash
git clone https://github.com/2lll5/caniagent
cd caniagent
node src/cli.js matrix
```

Run directly from GitHub without a global install:

```bash
npx github:2lll5/caniagent matrix
```

After npm publication, the shorter `npx caniagent matrix` form will also work.

### Compare capabilities

```bash
node src/cli.js feature mcp
node src/cli.js feature skills
node src/cli.js agent codex
node src/cli.js matrix --category automation
node src/cli.js matrix --search sandbox
```

### Check your repository before switching agents

```bash
node src/cli.js check . --agent codex
node src/cli.js check . --agent claude-code
node src/cli.js check . --agent gemini-cli --format json
node src/cli.js check . --agent codex --format sarif --output caniagent.sarif
```

The scanner recognizes compatibility-relevant agent surfaces such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SKILL.md`, and `.mcp.json`. Generic agent settings files are intentionally not treated as instruction files because their presence alone does not prove use of a matrix capability. It reports native conventions and migration attention points; it does **not** rewrite your repository.

## Current matrix

| Capability | Codex | Claude Code | Gemini CLI | OpenCode |
|---|:---:|:---:|:---:|:---:|
| Project instructions | ✅ | ✅ | ✅ | ✅ |
| Nested instruction scopes | ✅ | 🟡 | ✅ | ✅ |
| Agent Skills (`SKILL.md`) | ✅ | ✅ | ❔ | ✅ |
| MCP client | ✅ | ✅ | ✅ | ✅ |
| Lifecycle hooks | ✅ | ✅ | ❔ | ✅ |
| Non-interactive mode | ✅ | ✅ | ✅ | ✅ |
| Machine-readable output | ✅ | ✅ | ✅ | ❔ |
| Resume sessions | ✅ | 🟡 | 🟡 | 🟡 |
| Execution sandbox | ✅ | 🟡 | ✅ | 🟡 |

**Legend:** ✅ yes · 🟡 partial · 🧪 experimental · ❔ unknown · ❌ no

This table is a human-readable snapshot. `data/matrix.json` is the source of truth and contains per-cell notes, evidence URLs and checked dates.

## GitHub Action

Use CanIAgent in a pull request to surface migration-attention findings as SARIF. Pin third-party actions to reviewed commit SHAs so an upstream tag or branch cannot silently change what your workflow executes:

```yaml
name: Coding-agent compatibility
on: [pull_request]

permissions:
  contents: read
  security-events: write

jobs:
  caniagent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: 2lll5/caniagent@b3635be188a340f264cf5d99477dfdfe3784c3bd # reviewed main commit
        with:
          agent: codex
```

Set `upload-sarif: "false"` if you only want generation without GitHub code-scanning upload. The action has no hosted service dependency. Repository CI smoke-tests the composite action on GitHub-hosted Ubuntu, Windows, and macOS runners. When updating CanIAgent or checkout, review the new revision and replace the pinned SHA deliberately.

## Data API

The database is plain JSON:

```js
import fs from "node:fs";

const matrix = JSON.parse(
  fs.readFileSync("data/matrix.json", "utf8")
);

const mcp = matrix.features.find((x) => x.id === "mcp");
console.log(mcp.support["codex"]);
```

This makes CanIAgent usable from websites, CI jobs, editor extensions and other developer tools without depending on a hosted backend.

## Probe harness

Run:

```bash
npm run probe
npm run probe -- --output=.caniagent/probe.json
```

The v0.1 probe records which supported agent CLIs are installed, their versions, and their help output. The next milestone adds behavior fixtures for instruction precedence, MCP, skills, structured output and session resume.

Probe output is intentionally local by default. Do not publish logs that contain private paths or credentials.

## Static web app

`docs/` contains a dependency-free comparison UI that reads the same dataset. Serve it locally:

```bash
python -m http.server 8000 -d docs
```

Then open `http://localhost:8000`.

## Why this exists

Vendor docs answer "how does *our* agent work?" Developers switching tools need a different question answered:

- Will my `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` instructions survive the move?
- Are my skills portable?
- Does this agent support the same MCP transport/config scope?
- Can I run it in CI and parse structured output?
- What needs migration attention before I change my team workflow?

CanIAgent is designed to answer those questions without declaring a winner.

## Evidence policy

Compatibility is high-churn. See [METHODOLOGY.md](METHODOLOGY.md) for status definitions and evidence hierarchy.

A non-unknown cell should be backed by an executable probe, official documentation, or first-party source. If you find a wrong cell, please open an issue with the version, platform and minimal reproduction.

## Development

```bash
npm run validate
npm test
npm run lint
npm run check
npm run site:data
```

CanIAgent has **zero runtime dependencies** and supports Node.js 20+. CI also packs the npm artifact, installs that tarball into a clean temporary project, and runs the installed `caniagent` binary so missing publish files are caught before release.

## Contributing

Corrections, behavior probes and new agent adapters are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md).

## License

MIT
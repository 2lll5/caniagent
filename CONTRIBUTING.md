# Contributing

Thanks for helping keep coding-agent compatibility facts accurate.

## Quick start

```bash
git clone https://github.com/2lll5/caniagent
cd caniagent
npm run check
node src/cli.js matrix
```

There are no runtime dependencies.

## Change a compatibility cell

1. Edit `data/matrix.json`.
2. Add or update evidence and its `checked` date.
3. Run `npm run site:data`.
4. Run `npm run check`.
5. Explain the affected agent version or documentation revision in your pull request.

Prefer `unknown` over inference. Use `no` only when an authoritative source or reproducible probe demonstrates lack of support.

## Add an agent

An agent should have a public CLI or developer-facing coding-agent interface, active maintenance, and enough adoption that compatibility information benefits more than one project.

Add the agent record, fill every feature cell, update tests, and include authoritative evidence.

## Add a feature

A feature should be portable enough to compare across multiple coding agents. Vendor-specific UI details usually belong in notes rather than new rows.

## Probe contributions

Behavior probes are especially valuable. Keep fixtures minimal and deterministic. Never commit tokens, credentials, private prompts, or unredacted logs.

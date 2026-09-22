# Public compatibility data

CanIAgent publishes the same compatibility dataset used by the static comparison site as plain JSON on GitHub Pages:

```text
https://2lll5.github.io/caniagent/matrix.json
```

The endpoint is a static snapshot generated from `data/matrix.json`; it does not require authentication or a hosted API service. Consumers should treat feature IDs and agent IDs as identifiers, preserve unknown fields for forward compatibility, and use each support entry's evidence and checked date rather than inferring support from missing data.

For local or version-pinned integrations, read `data/matrix.json` from a specific repository revision instead. The public endpoint follows the currently deployed Pages build and therefore can change when `main` is deployed.

## Example

```js
const response = await fetch("https://2lll5.github.io/caniagent/matrix.json");
if (!response.ok) throw new Error(`CanIAgent data request failed: ${response.status}`);

const matrix = await response.json();
const mcp = matrix.features.find((feature) => feature.id === "mcp");
console.log(mcp.support.codex);
```

Compatibility claims remain governed by the evidence policy in [`METHODOLOGY.md`](../METHODOLOGY.md). Publishing the JSON does not promote unknown or unverified statuses.

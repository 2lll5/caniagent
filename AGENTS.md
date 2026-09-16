# CanIAgent contributor instructions

- Keep the compatibility database evidence-first. Never turn an unverified assumption into `yes` or `no`.
- Prefer official documentation and first-party source code. Add a `checked` date for every evidence item.
- Run `npm run check` before committing JavaScript or matrix changes.
- When `data/matrix.json` changes, run `npm run site:data` and commit the matching `docs/matrix.json`.
- The CLI intentionally uses only Node.js built-ins. Avoid runtime dependencies unless the benefit is substantial.
- Preserve Node.js 20 compatibility.
- Unknown is a valid status and is preferable to guessing.

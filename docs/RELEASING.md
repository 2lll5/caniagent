# Publishing a GitHub Release

GitHub Releases are deliberately **manual**. Changing `package.json`, editing
release automation, merging a pull request, or pushing a tag does **not** publish
a release. This avoids unintended versions and unnecessary GitHub Actions runs.

1. Update `package.json` and `package-lock.json` together (for example,
   `npm version 0.4.0 --no-git-tag-version`). Open a PR and wait for the usual
   CI checks; merge it to `main` after review.
2. Create and push an explicit `v`-prefixed version tag on the intended
   commit on `main` (for example, `v0.4.0`). Review the commit before tagging.
3. In **Actions → Release → Run workflow**, select the workflow on `main` and
   enter the **existing tag** in the `tag` input. Only this manual dispatch
   attempts to publish a GitHub Release.

Dispatching the workflow from a branch or tag other than `main` is rejected.

The workflow verifies that the tag exists, has a valid `v`-prefixed version,
points to a commit reachable from `main`, and matches the versions in both
`package.json` and the root entry of `package-lock.json` **at that tag**. It
runs `npm run check` on the tagged source before publishing. An existing
release is treated as a no-op. The workflow never creates or moves tags.

The workflow publishes a **GitHub Release**, not an npm package. Any npm
publication must be handled separately and deliberately. Compatibility claims
still require the evidence process in [METHODOLOGY.md](../METHODOLOGY.md).

---
name: release
description: Cut a release of the extension: bump versions, verify, package for Chrome and Firefox, tag. Use when the user says release, publish, ship a version, or bump version.
disable-model-invocation: true
---

Argument: the new version (e.g. `1.2.0`); ask if missing. There is no compile step — packaging just zips the `INCLUDE` list, so the working tree is what ships.

1. Bump `version` in all three: `manifest.json`, `manifest-firefox.json`, `package.json`. `npm run check` fails if they disagree, or if README names a stale `-v<x.y.z>`.
2. Run `/verify`. Abort on failure.
3. `npm run package` and `npm run package:firefox`. Confirm both land in `release/` with the new version in the filename and `unzip -l` shows `manifest.json` in each.
4. Commit `Release vX.Y.Z`. **Ask before tagging or pushing**, then `git tag vX.Y.Z && git push origin main vX.Y.Z`. The tag triggers `.github/workflows/release.yml`, which rebuilds and attaches both artifacts to a GitHub Release with generated notes. The tag must be exactly `v<manifest version>` — the workflow fails otherwise, so step 1 has to be committed before tagging. That also means the workflow can no longer be smoke-tested with a throwaway tag.
5. Store submission is manual: upload the `.zip` at the [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole) (description ≤132 chars; a version can only be uploaded once). Firefox is dev-only — the `.xpi` is unsigned and loads temporarily via `about:debugging`, so there is no AMO step unless you decide to sign it.

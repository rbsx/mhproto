# Offline Mermaid runtime

Mermaid 12.1.0 is rebuilt as one browser file so the local viewer and exported HTML
render without a network dependency. The viewer uses strict security, disables
HTML labels and keeps invalid diagram sources readable beside an error.

## Reproducible source build

`manifest.json` pins upstream commit `21f72f07ea22c0af48a3149c550654e80d8e40cb`, the
source archive SHA-256, build package/lock hashes and final bundle hash.
`scripts/mermaid-build.mjs` extracts unchanged upstream source and uses its official
Jison/schema plugins and browser build settings with esbuild 0.28.2.
`tools/mermaid/package-lock.json` selects DOMPurify 3.4.16, js-yaml 4.3.2 and
Lodash 4.18.1. The upstream prebuilt 12.1.0 artifact still contained affected
DOMPurify/js-yaml versions; it is not used here.

The build prepends Mermaid's MIT text, keeps its namespace private in an outer
IIFE, and appends the complete notice file as a comment. The upstream runtime
source is unchanged. Dependency selection differs from upstream's published build.

```sh
npm run verify:vendor
npm run audit:vendor
```

Verification downloads the pinned source archive, installs the exact build lock
without install scripts, rebuilds in a fresh temporary directory and compares the
complete bytes. It verifies all input paths and nested parser chunk hashes in
`build-evidence.json`. A previously downloaded source archive can be supplied:

```sh
node scripts/verify-mermaid.mjs /path/to/source.tgz
```

## Notices and package coverage

`license-inventory.json` records 79 package/version entries with exact archive
integrity and original notice hashes. `build-evidence.json` records esbuild inputs
and 32 official parser 2.0.1 chunk/map identities. Their source maps expose nested
packages; flattened vscode-uri and path-browserify texts also match their archives.
Coverage is conservative: esbuild inputs may include tree-shaken source portions.

`NOTICE.txt` combines full licenses and embedded attributions. `licenses/` retains
original archive texts. Fastdom's archive contains its MIT terms in the README;
the original README is retained, and only its license section enters the appendix.
Individual notice bytes retain original line endings; the appendix uses LF.
DOMPurify's Apache-2.0 option is selected; its full dual-license text is retained.
ELK's EPL-2.0 license, copyright and source availability notice are included.
Khroma's MIT license comes from its license text rather than its metadata.

```sh
node scripts/verify-mermaid-licenses.mjs
```

This verifies the 79 pinned npm archives without executing package scripts,
original notice bytes, nested parser source identities and recorded coverage.
An optional argument accepts an archive cache using the package/version directory
names derived in the verifier. All notices travel inside the offline bundle.

## Security checks and future upgrades

`bundled-audit.json` records the 2026-10-03 live registry advisory response: no known
matches for the recorded versions. `npm run audit:vendor` repeats the exact-version
check and fails if matches appear. Ordinary root `npm audit` does not inspect
compiled dependencies hidden inside this renderer. CI runs both audits and also
audits `tools/mermaid` build dependencies.

For an upgrade, pin a verified upstream source archive and build lock; regenerate
the bundle and build evidence; inspect every direct and nested source-map package;
retain each original license plus source availability where required; update the
manifest, inventory, notices and audit. Require byte reproduction and the full
CLI, browser and packed-consumer checks. Do not substitute a prebuilt file without
repeating its nested dependency and notice review.

Upstream: https://github.com/mermaid-js/mermaid

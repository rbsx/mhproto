# Preview release review

Reviewed 2026-10-03. **Prepared version: `0.8.0-preview.0`, for the npm `next` tag.**
The previous renderer security gate is cleared by an independently repeatable
source build with patched dependencies. No npm publication has occurred.

## Changes that cleared the gate

The renderer is rebuilt from Mermaid 12.1.0 at upstream commit
`21f72f07ea22c0af48a3149c550654e80d8e40cb`. The verified source archive,
unmodified upstream schema/Jison plugins and committed dependency lock reproduce
the vendored executable bytes. DOMPurify is 3.4.16, js-yaml is 4.3.2, and all
bundled Lodash is 4.18.1. The new parser uses Chevrotain 13.2.0 and Langium 4.4.0;
the old vulnerable nested Lodash dependency is gone.

The exact-version registry audit reports no known advisories for the 79 recorded
renderer package versions, including dependencies inside 32 compiled parser
chunks. Both the library's dependency tree and the renderer build dependency tree
audit clean. Registry signatures and available provenance for the library's
installed dependencies verify. Recheck these time-sensitive results before
publication; an audit is not a penetration test.

The retained license inventory covers those 79 entries. Original archive bytes,
parser source-map identities and flattened vscode-uri/path-browserify sources
verify. Full notices remain embedded in the renderer for offline exports. ELK's
EPL-2.0 text, copyright and source availability links are included. DOMPurify's
Apache-2.0 alternative is selected. See [third-party notices](../THIRD_PARTY_NOTICES.md)
and [the renderer manifest](../viewer/vendor/manifest.json).

## Required candidate evidence

`npm run release:prepare` requires a clean committed checkout, then runs:

- Formatting and all 58 tests, including actual flow/state/sequence SVG rendering.
- Library advisory/signature checks, a clean renderer rebuild, archive license
  verification, the exact bundled-version audit and build dependency audit.
- Desktop/mobile Chromium flows over HTTP and offline save/reload.
- A fresh install of the exact tarball: public import, executable CLI, scaffold,
  ten Codex/Claude skill copies, validation, scoped context, linked checks,
  evidence freshness, snapshot/diff and portable export.
- Installed-package HTTP and offline browser flows with diagrams and linked types.

It writes `artifacts/release/mhproto-0.8.0-preview.0.tgz` and a manifest containing
its source commit, SHA-256, SHA-512 integrity and complete packed file list.
Website source, test fixtures, build tooling and credentials are excluded.
GitHub runs the Linux/macOS, Node 22/24 matrix, audits, renderer verification,
desktop/mobile browser suite and packed-consumer smoke for the release commit.
Require all jobs to pass before publication.

## Remaining publication steps and limits

This machine has no npm login (`npm whoami` returned ENEEDAUTH). The `mhproto` name
returned E404, which is not a reservation or ownership guarantee. Publication
requires the package owner's npm authentication, approval of the tested archive,
and a final current audit/name check. Follow [the publishing steps](publishing.md).

Node 22 and 24 on Linux/macOS are the tested targets. Windows and browsers other
than Chromium remain unverified. Mermaid 12's browser targets are Safari/iOS 17.4,
Chrome/Edge 121 and Firefox 123 or newer. The package remains a development preview:
check results are evidence, the validator supports a documented OpenAPI/JSON
Schema subset, evidence does not track external service or tool-version changes,
and multiple viewer processes do not coordinate attachment writes. Diff reports
contract changes, not a breaking-change classification.

The website is maintained in a separate private repository. Its npm installation
copy must change only after the package becomes available. The
[dated original review](release-review-2026-10-02.md) preserves earlier findings
and historical limitations; its old release gates are superseded here.

# Contributing to MHProto

Use Node 22 or 24 and npm. Install the locked dependencies with `npm ci`.

```sh
npm run check
npm run format
```

`check` runs formatting and the Node/DOM tests. Tests use temporary projects and
clean them up. They cover actual CLI calls, structured Node test events, path
containment, schema validation, offline exports, type navigation and comparison.
JSDOM tests do not establish painted browser layout.

For real HTTP and desktop/mobile Chromium flows, install the pinned browser and run:

```sh
npx playwright install --with-deps chromium
npm run test:browser
```

The browser suite starts a loopback viewer, exercises navigation, linked types,
attachment ownership and persistence, iteration diffs and offline save/reload.
It writes screenshots and console diagnostics to `test-results/browser/`. Review
the screenshots for layout; automated assertions do not replace visual judgment.
GitHub CI uploads these artifacts along with dependency-audit and registry-signature
reports. The offline Mermaid renderer is source-built with a separate locked dependency
set. CI verifies a clean byte-identical rebuild, all retained licenses, the
exact bundled-version advisory audit and the build dependency audit. See
[the renderer notes](viewer/vendor/README.md).

Keep changes scoped. Add regression tests for observable bugs. Preserve the
single-owner attachment policy and the distinction between failed, stale and
unchecked evidence. Agent context must retain exact rules and explicit deferred
references. Add a screenshot for changes to the reading flow.

## Code map

| Area                                                | Files                                 |
| --------------------------------------------------- | ------------------------------------- |
| Contract input and validation                       | src/core.mjs, src/config.mjs          |
| Scoped agent context                                | src/context.mjs                       |
| Verification and Node reporter                      | src/verify.mjs, src/node-reporter.mjs |
| Contained writes and attachment metadata            | src/paths.mjs, src/visuals.mjs        |
| Local HTTP viewer and offline export                | src/server.mjs                        |
| CLI workflows                                       | bin/mhproto.mjs                       |
| Reading, types, attachment ownership and navigation | viewer/app.js                         |
| Pure snapshots and semantic comparison              | viewer/diff.js                        |
| Agent workflows and format reference                | skills/                               |

There is no compilation step. The shared comparison module runs in Node and in
the browser. Standalone export inlines that module, the viewer and Mermaid.

## Before a public release

Read [the publishing steps](doc/publishing.md) and doc/release-review.md. Run `npm run release:prepare` from a clean committed checkout to produce and test
the preview archive. Preparation does not publish it.
`npm pack --dry-run --json --ignore-scripts` inspects the planned file list without
creating an archive. `npm pack` runs the prepack check before creating a package.
Verify a clean installation of the resulting tarball in a separate project before
publishing. Do not put local app copies, evidence, screenshots, credentials or
machine-specific paths in the npm package.

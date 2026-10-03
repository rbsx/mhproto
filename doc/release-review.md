# Pre-release code review

Reviewed 2026-10-02. **Decision: keep the package private; do not create or publish a new npm release yet.** The implementation is materially safer and more predictable after the fixes below. Remaining release gates are concrete verification work, not a request for a broad rewrite.

## Status update: 2026-10-03

The original findings and local-only evidence below are retained as a dated review.
Subsequent work cleared these gates:

- The hosted Linux/macOS, Node 22/24 matrix, dependency audit/signature job and
  desktop/mobile Chromium suite passed for
  [commit 7d75f8b](https://github.com/rbsx/mhproto/actions/runs/37068214828).
- Live npm audits reported no known vulnerabilities in the locked dependency tree.
  This does not authenticate the copied Mermaid bundle.
- The library is public at https://github.com/rbsx/mhproto, and the homepage,
  documentation and interactive demo are live at https://mhproto.dev.
- Desktop/mobile website flows and offline demo save/reload passed in Chromium.

Mermaid upstream provenance and its complete license inventory remain open.
An actual tarball consumer installation remains to be checked after that gate.
Windows remains unverified. No npm version has been published; `private: true`
remains enabled. See [publishing steps](publishing.md) for the release sequence.

## Scope and method

Reviewed the CLI, file loading and writes, metadata validation, OpenAPI/schema handling, scoped agent context, verification evidence, HTTP handler, portable exports, visual attachments, type navigation, comparison module, five bundled skills, dependency lockfile and planned npm contents. Checked the isolated Impostor pilot against the revised implementation. The original application was not edited.

Used source inspection, actual CLI subprocesses, regression tests, JSDOM, the vendored Mermaid runtime, a fresh locked dependency install and an isolated planned-package layout. This is an engineering review, not a penetration test or a certification of the entire OpenAPI standard. Local checks ran on macOS with Node 24.18.1. The configured Node 22/24, Linux/macOS CI matrix has not run on a hosted repository.

## Findings fixed

Severity indicates the effect on MHProto's advertised guarantees. High means incorrect verification/contract acceptance or an unintended write/disclosure boundary; medium means incorrect output, comparison or workflow behaviour. It does not assert remote exploitability.

| Priority        | Finding and prior consequence                                                                                                                                 | Change and evidence                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High            | Node TODO tests could count as passing even though Node permits them without a failing exit code. Nonterminal reporter events could satisfy an expected name. | Require completed pass/fail events; reject TODO, skipped, missing and failing tests. Added real TODO and fabricated-event regressions, plus UTF-8 split handling.                                                                                                                                             |
| High            | Unbounded or malformed structured reporter output could undermine verification and consume excessive memory.                                                  | Bound structured output to 1 MB, reject malformed/oversized streams and stop the command on overflow. Retain bounded ordinary output. Verification still runs trusted commands with inherited environment; it is not a sandbox.                                                                               |
| High            | Boolean `false` schemas were treated as absent/empty; invalid inline schemas without examples could escape validation.                                        | Preserve boolean schemas; compile declared inline schemas even without payloads. Validate named media examples. Cache compiled schemas. Regressions cover rejection and display/context preservation.                                                                                                         |
| High            | Evidence could remain fresh after configuration, system rules or declared test-file changes.                                                                  | Include those inputs in the revision digest alongside capability and tracked source files. Bound directory traversal through symlink cycles. Regression mutates each missing input.                                                                                                                           |
| High            | Several generated writes lacked the same real-path containment as reads and could follow escaping symlinks.                                                   | Centralize contained writes and unique atomic replacement. Preflight CLI destinations; reject existing init/skill destinations and root-directory exports, including root aliases. Regressions prove outside files are preserved. This is not protection against a hostile concurrent filesystem mutator.     |
| High            | Shareable exports contained captured process output, executed command records and the generated machine root path.                                            | Export an evidence-summary whitelist. Keep status, timing and observed test names; omit captured logs/errors and generated paths. Validate and prepare all output before replacing files. Authored commands/environment values, contracts, examples and attachments remain and require review before sharing. |
| Medium          | Local OpenAPI object references and path-level parameter overrides were not consistently resolved.                                                            | Resolve local path/parameter/request-body/response refs, reject cycles and duplicate parameters, apply operation overrides by name/location, decode JSON pointer names and include TRACE. Regression verifies context and payload validation.                                                                 |
| Medium          | Response example validation mishandled declared status ranges; metadata errors could become incidental runtime failures.                                      | Match explicit status, `2XX` and default responses. Validate MHProto metadata with source-file diagnostics, reject unknown fields and allow `x-*` extensions. Preserve the pilot's existing check description field.                                                                                          |
| Medium          | Viewer nullability/false schemas and unsafe imported design links could be misrepresented.                                                                    | Preserve nullable object type arrays and `never` schemas. Actionable design links require HTTPS without credentials. Imported preview HTML is read as marked JSON without constructing an HTML document or executing scripts.                                                                                 |
| Medium          | Diff normalization could ignore payload array order when a property happened to be named `rules`; path metadata could be missed.                              | Distinguish literal payloads from unordered reference sets and compare path-level metadata. Fenced rule examples remain prose rather than invented normative rules. Added regressions for each case.                                                                                                          |
| Medium          | Missing CLI values, unsupported flags and invalid skill agents could fail after partial scaffolding.                                                          | Validate command-specific options and preflight destinations; help never performs work. Added CLI subprocess regressions.                                                                                                                                                                                     |
| Release hygiene | License declaration lacked a top-level license file; source style, contributor guidance and dependency provenance were incomplete.                            | Added MIT LICENSE, third-party notices, contributor guide, formatter/check scripts, CI configuration and vendor hash/provenance manifest. Raised the YAML minimum to 2.8.3. Kept `private: true`.                                                                                                             |

The YAML minimum follows the [maintainer's security advisory](https://github.com/eemeli/yaml/security/advisories/GHSA-48c2-rrv3-qjmp), which identifies 2.8.3 as the fix for deeply nested input causing a stack overflow. The locked install uses YAML 2.9.1. This specific fix does not establish that all dependencies are free of known vulnerabilities.

## Validation results

- **58/58 framework tests pass**, with no skips or TODOs. The previous suite had 44 tests; 14 additional regressions cover the review findings.
- Formatting passes. Tests clean up their temporary projects.
- **23/23 linked Impostor checks pass** with the revised verifier. The final contract check reports **0 errors and 12 warnings** for rules without linked executable checks. Those gaps remain visible; passing linked checks do not imply full behavioural coverage.
- Pilot tests exercise application services and HTTP handlers in process with a request/response double, an in-memory database and stub witnesses. They do not prove socket transport, deployed behaviour or live model quality. No paid model evaluation was run.
- A fresh `npm ci --offline --ignore-scripts` installs all 47 locked dependencies into an isolated source checkout. Offline installation verifies lock/cache consistency, not dependency security.
- The isolated source checkout also passes formatting and all 58 tests.
- Planned package-layout smoke verifies the public import, executable CLI, scaffold, five skill installs, validation, scoped context, snapshot/diff and portable viewer export from staged npm-listed files. It uses an isolated dependency install; it is not an installation from an npm tarball.
- `npm pack --dry-run --json --ignore-scripts` inspects the planned files without creating an archive. No application copy, local evidence, screenshots, test fixtures, node_modules or credentials are included. CLI executable mode, skills, viewer assets and licenses are included.
- The planned package now contains 33 files including the separate guide, approximately 1.05 MB packed and 3.80 MB unpacked. The reused Mermaid bundle accounts for about 94% of the unpacked bytes; a reproducible renderer build is the main dependency/size decision.
- Standalone exports execute their shared comparison in JSDOM with network access disabled; Mermaid examples render with the actual local bundle. These checks do not establish painted layout, keyboard behaviour in a real browser or real HTTP transport. Local socket/browser preview was unavailable in this environment.
- The final exported Impostor preview passes an offline DOM smoke with six endpoints, a linked type page, rendered Mermaid SVG and 23 fresh passing evidence summaries. It performs no fetch; SVG text measurement is approximate.

## Release gates still open

| Gate                                     | Required evidence                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live dependency audit                    | Run a current audit and inspect relevant advisories for runtime dependencies and the vendored renderer. The attempted npm audit failed because registry DNS was unavailable; it did not return a clean audit.                                                                                                    |
| Mermaid provenance and licenses          | Obtain an official upstream artifact or reproducible build; verify the bundle identity and complete transitive license inventory. The reused bundle's claimed version is 11.16.1, but that claim is **not authenticated**. Its recorded SHA-256 identifies the local bytes only. Embedded notices are preserved. |
| Supported runtimes and real viewer smoke | Run the configured hosted Linux/macOS, Node 22/24 matrix. Test actual HTTP transport and review desktop/mobile pixels, keyboard navigation, attachment ownership, type pages and offline import/export in real browsers. Windows remains unverified.                                                             |
| Actual package installation              | After the preceding gates, create a tarball, install it into a clean consumer and repeat the CLI/import/offline viewer smoke. Review final packed contents. The older downloadable 0.7.0 prototype predates this review and is not a reviewed release.                                                           |
| Public project metadata                  | Choose the public repository and add accurate repository/issue links; verify npm package/scope ownership and the Cloudflare homepage setup. Remove `private: true` only as part of the reviewed release. Nothing was published or deployed by this review.                                                       |

## Maintainability and declared limits

Backend responsibilities are now separated into metadata validation, contained paths, contract handling, context, verification, visuals and serving. Comparison stays a single pure module shared by Node and the browser. Attachment actions retain one owner; fields render types and expansion only.

The viewer remains a large DOM module. Before adding another major flow, separate type indexing, rendering and attachment/diff controllers behind the existing observable tests. A framework migration or comprehensive rewrite is not necessary for the current preview.

The contract validator implements a documented subset of OpenAPI 3.1 and JSON Schema 2020-12 with local references. Viewer signatures primarily handle application/json. Check success is evidence, not proof; trusted commands can forge their own output. Evidence tracks files, not tool upgrades or external environment/service state. Separate viewer processes do not coordinate attachment writes. Diff is a contract delta, not breaking-change classification; unchanged visual metadata does not detect changed asset bytes. Scoped context reduces supplied material but does not guarantee billed token savings.

Treat these as documented preview boundaries. Do not hide them behind an expansive “fully validated” claim.

## Release-check preparation after the documentation move

The concise README and separate guide are preserved. Repository/issue metadata now
points to rbsx/mhproto. CI has additional dependency advisory/signature checks and a
desktop/mobile Chromium flow suite using pinned Playwright 1.63.0. Browser artifacts
include screenshots and console diagnostics; tests cover actual HTTP, navigation,
type expansion/backlinks, attachment ownership/persistence, diff details and offline
preview save/reload without external requests. These tests use a synthetic contract,
not production data or live model calls.

The preparation has not cleared those gates. GitHub/npm DNS is unavailable in this
execution environment, so the new jobs cannot be pushed or inspected here, and the
real-browser suite cannot run under the local socket/browser restrictions. The
existing 58-test suite still passes. Browser syntax, fixture contract validity and
the new locked dependency install are checked separately; none is reported as a
successful real-browser run. Mermaid provenance/licences and actual tarball
installation remain open. No package was created or published.

The updated 49-dependency lock installs successfully from the offline cache into
an isolated checkout, and that checkout passes formatting and all 58 tests. The
browser fixture validates with no contract errors and produces the intended
linked-type diff. Planned npm contents exclude the browser fixture, browser suite
and screenshots. Offline installation does not clear the live audit/signature gate.

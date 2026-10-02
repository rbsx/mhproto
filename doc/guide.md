# MHProto guide

Detailed usage and reference documentation for the [project website](https://mhproto.dev/docs/).

## Start locally

This is a development preview, not an npm registry release. Node 22+ is required.
The hosted CI matrix covers Node 22/24 on Linux and macOS and [has passed](https://github.com/rbsx/mhproto/actions/runs/37059758163). Windows is unverified.

From a checkout of this repository:

```sh
npm ci
npm run check
```

In your application, install the checkout and create a draft contract:

```sh
npm install --save-dev /path/to/mhproto
npx mhproto init --agent codex
npx mhproto check
npx mhproto snapshot
npx mhproto view
```

Replace the example with your feature. `init` refuses to overwrite existing
contracts or skills. `skills --agent codex|claude|all` installs repository-local
skills in `.agents/skills` or `.claude/skills`; global agent settings stay unchanged.
The isolated Impostor pilot is a development fixture, not a package prerequisite.

## Commands

| Command         | Result                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| init            | Scaffold a draft capability and install skills                           |
| skills          | Install the bundled agent skills separately                              |
| check           | Validate references, schemas, payload examples and check bindings        |
| context         | Retrieve a compact index or scoped endpoint/rule/schema packet           |
| inspect         | Emit the normalised project model as JSON                                |
| verify          | Run linked argv commands, store revision-bound evidence                  |
| view            | Serve a local viewer; save visual attachments and refresh source changes |
| snapshot / diff | Save a baseline and inspect contract changes                             |
| build           | Export viewer assets, model.json and a self-contained viewer.html        |

Use `--root PATH` for another app. See `mhproto help` for command options and `skills/mhproto-specify/references/format.md` for the data format.

## Viewer

The sidebar lists the project and its features. A feature opens one page: title, product/logic description, relative app URL, visible API request/response signatures, play-state diagrams and a Checks section. Search stays at the top; Sources is a secondary link in the sidebar.

Each endpoint opens its own page with a stable `#/features/:feature/api/:operation` URL. Behaviour, errors, examples and checks are attached to that endpoint. Named types are clickable inside their signatures. Each type opens a shareable definition page with links to feature overviews, every endpoint using it and referencing type pages. Nested objects still expand in place; there is no separate type catalogue or modal navigation. The Copy page link action preserves direct navigation to the endpoint.

The visual system uses white backgrounds, near-black text, neutral dividers and blue/purple links. HTTP method badges retain restrained colour coding. See `doc/viewer-design.md` for the flows and acceptance criteria.

Optional capability `url` identifies the app route. `presentation.operationOrder` orders endpoints by use. `presentation.operations[operationId]` accepts `description`, a concise `behaviour` summary, additional `rules`, optional `ruleGroups` (`title`, `rules`) and `diagrams` (`title`, Mermaid `source`). `ruleTitles` supplies concise labels in search and check gaps. These are navigation and context; full source clauses remain authoritative. Operation and rule references are validated.

Mermaid fences in the behaviour/system document and endpoint diagrams render as monochrome SVG. The bundled Mermaid runtime also works offline in the exported HTML. Diagram source stays available on demand; invalid diagrams show an error without blocking the rest of the page. The CLI validates diagram metadata, not Mermaid syntax; renderer tests and preview review establish diagram validity.

`mhproto build --out ./mhproto-preview` creates a portable `viewer.html` that can be opened without a server. In the live viewer, attachments save to `mhproto/visuals.yaml` and `mhproto/assets`. In an exported snapshot, attachments stay in that preview; **Save preview** downloads a self-contained copy with them. Edit the source files to change normative contract text.

Portable exports include check status, timing and observed test names, but omit captured stdout/stderr, failure messages, executed command records and the generated project-root path. Authored contracts, configured check commands/environment values, examples and attachments are retained. Review those files before sharing; export is not a secret scanner.

## Verification semantics

Unchecked, passing, failing and stale are distinct. Node checks require exact expected test names and structured results; missing/skipped/TODO tests fail. Evidence includes commands, exit status, timings, observed tests and a SHA-256 digest of the project configuration, system document, capability files, explicitly tracked sources and declared check files. Failures are recorded. Checks execute sequentially, with a timeout. They inherit the environment and execute the configured commands without a shell; they are not sandboxed. Run verification only for check commands you trust. Structured Node reporter output is bounded to 1 MB and fails closed if malformed or oversized.

MHProto validates payload schemas and examples and its own cross-references; this is a bounded contract validator, not a complete OpenAPI standards validator. V0 supports OpenAPI 3.1 with local refs. Interfaces can originate in Zod, Protobuf tooling or handwritten OpenAPI, but only OpenAPI is consumed in this version. Optional type generation remains with the app’s chosen generator.

A linked passing test is evidence for a rule, not proof of all its cases. Prompt-text tests do not establish live AI behaviour. Runtime permissions, races and retry behaviour require meaningful app tests. No paid evaluation is invoked by the pilot.

Browser editing of normative contract text, type generation, remote schema refs and hosted collaboration are deferred.

## Develop

Node 22+. `npm ci`, `npm run check`, `npm run format`. See CONTRIBUTING.md and doc/release-review.md. Package creation is held until the release gates pass. The CLI and viewer run directly from source; no build step is needed. Dependencies: yaml, Ajv, ajv-formats. The viewer uses platform DOM APIs and escapes source content.

## Visual references

Attach a screenshot, design image/PDF or HTTPS design link using the single `+` after a feature/endpoint description, scenario, rule or check text, or alongside a Request/Response header. The action appears on hover or keyboard focus and opens an inline form. Schema signatures and nested object fields only render types and expansion; they do not create attachment controls. Existing field/schema references appear beneath the matching request/response header. Supported files: PNG, JPEG, WebP, GIF and PDF, up to 8 MB. Design links open their source rather than loading an embedded design app. The metadata format is in the bundled format reference.

Collapsed object fields show a pale-yellow `{...}`; optional markers, nullability, arrays and constraints remain visible. Expand in place to inspect their fields.

## Compact agent context

```sh
mhproto context
mhproto context --capability daily --operation tap --stats
mhproto context --capability daily --operation tap --section request,response
mhproto context --capability daily --rule DAILY-PLAY-4
mhproto context --capability daily --schema DailyPlayState
```

Packets are assembled in code, not summarised by a model. Rule text and failure semantics remain exact. Nested types and grouped rules are explicit references, payload examples are fetched separately, and check summaries retain freshness. Image bytes, Mermaid's runtime, repeated OpenAPI examples and raw execution logs never enter these packets. The default 12,000-character budget fails visibly if exceeded; it never silently truncates rules. This reduces input context size; actual tokens and billed cost depend on the model and subsequent reads. See [context-design.md](context-design.md) for research, limitations and measurements.

## Linked type entities

Signatures label declared component types by their existing OpenAPI names: `DailyTodayResponse { ... }`, `case: DailyCaseView {...} | null`, and `play: DailyPlayState {...} | null`. Type names link to `#/features/:feature/types/:type-id`. Fields remain inline and expandable. Following the type link opens its page; selecting the yellow placeholder expands the object.

The type page shows the definition and a Used in section containing feature overview and endpoint links. Backlinks include nested/transitive uses, all declared response statuses, and direct references from other type pages. A type name can also be found through project search. Nothing is added to the sidebar or to object attachment controls.

Unnamed query/path/header/cookie structures, inline bodies/responses and nested object items receive deterministic viewer labels, such as `GetTodayQuery` and `DailyRoundAnswersItem`. These pages explain where the structure comes from; labels do not create new application types or change the contract. Declared names take priority, and generated name collisions remain separate. Types shared through the same interface file link across features; equally named types from different interfaces stay distinct. Cycles are bounded.

The index is built once per loaded model in the viewer and cached until that model changes. It is not serialized into the project model, snapshots or scoped agent packets, and does not duplicate the authoritative schemas. Type pages remain compatible with the standalone export.

## Review an iteration

Open **Changes** in the sidebar. Choose an earlier snapshot JSON or exported MHProto preview HTML, or **Use current spec as baseline** before editing. Changes lists added, changed and removed items by feature. Open an item for its changed fields with Before/Now values, then follow **Open current** to see it in context. Comparison links retain `?compare=1`; **Hide highlights** returns to normal reading. Changed type names and added/changed/removed fields are marked inline. Removed definitions remain reviewable on their change page.

```sh
mhproto snapshot --label "Before case history" --out .mhproto/iterations/before-history.json
# Edit the source contract, then:
mhproto view --against .mhproto/iterations/before-history.json
mhproto build --against .mhproto/iterations/before-history.json --out ./review
mhproto diff --against .mhproto/iterations/before-history.json
```

Without `--against`, the viewer uses `.mhproto/baseline.json`. The live **Use current spec as baseline** action replaces that local baseline with the current contract. When using `--against`, this action is disabled by the server so an explicit saved iteration is retained. **Download current snapshot** exports a named JSON baseline. In a standalone preview, save the amended preview to retain its selected/new baseline. Imported files stay in the viewer; importing an HTML preview reads its model without executing its scripts. Shared URLs require the same current spec and baseline to produce the same comparison; the exported HTML carries both.

The comparison is one pure module shared by CLI, server and browser. It covers feature/system text, API operations and global settings, named schemas, attached behaviour/presentation, examples, check definitions and visual metadata. Object key order and unordered sets (required fields, enums and rule references) do not count as changes. Runtime paths, digests, evidence timestamps, test output and renderer code are excluded. Snapshot data is detached from current data and carries no execution logs. This is a spec delta, not an automatic breaking-change assessment or a code diff. Visual asset bytes are not compared when their metadata/path stays unchanged. Agent context packets remain unchanged.

## Release status and boundaries

This preview is held with `private: true`. Public release still requires a live
dependency audit, upstream provenance and license checks for the reused Mermaid
bundle, a clean tarball installation and painted browser QA. The
existing downloadable 0.7.0 prototype predates this review and is not a reviewed
release.

The validator is intentionally bounded: JSON Schema 2020-12 payloads, local JSON
pointer references and linked metadata. It does not implement the whole OpenAPI
standard. The viewer primarily renders application/json structures. Agent context
is scoped retrieval, not equivalent-content compression or guaranteed token savings.
Visual metadata writes are serialized within one process; concurrent writers
from separate viewer processes are not coordinated. Revision-bound evidence
tracks files, not every external service or environmental change.

MHProto source is MIT-licensed. See LICENSE and THIRD_PARTY_NOTICES.md for the
separately licensed viewer dependency.

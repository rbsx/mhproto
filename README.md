# BIVE

Behaviour · Interface · Verification · Examples.

A local, file-backed contract workspace for humans and coding agents. One npm package provides a parser, CLI, browser viewer and five installable agent skills. No hosted service or AI account is required.

## Local pilot

From the sibling `imposter-bive-pilot` directory:

```sh
npx bive check
npx bive verify --capability daily
npx bive view --port 4317
```

The pilot reuses Impostor’s daily-case Markdown and generated OpenAPI; its original authoritative docs remain authoritative. Tests run against an in-memory database and stub witnesses, with no model calls. Original application sources outside the pilot are not modified.

## Another project

```sh
npm install --save-dev /absolute/path/to/bive
npx bive init --agent codex
npx bive check
npx bive snapshot
npx bive view
```

Replace the example with a real capability. `init` refuses to overwrite existing files. `skills --agent codex|claude|all` installs repository-local skills in `.agents/skills` or `.claude/skills`. It does not change global agent settings. The package is local and has not been published to npm.

## Commands

| Command | Result |
| --- | --- |
| init | Scaffold a draft capability and install skills |
| skills | Install the bundled agent skills separately |
| check | Validate references, schemas, payload examples and check bindings |
| context | Retrieve a compact index or scoped endpoint/rule/schema packet |
| inspect | Emit the normalised project model as JSON |
| verify | Run linked argv commands, store revision-bound evidence |
| view | Serve a local viewer; save visual attachments and refresh source changes |
| snapshot / diff | Save a baseline and inspect contract changes |
| build | Export viewer assets, model.json and a self-contained viewer.html |

Use `--root PATH` for another app. See `bive help` for command options and `skills/bive-specify/references/format.md` for the data format.

## Viewer

The sidebar lists the project and its features. A feature opens one page: title, product/logic description, relative app URL, visible API request/response signatures, play-state diagrams and a Checks section. Search stays at the top; Sources is a secondary link in the sidebar.

Each endpoint opens its own page with a stable `#/features/:feature/api/:operation` URL. Behaviour, errors, examples and checks are attached to that endpoint. Nested objects expand inside their signatures; there is no shared-type browser or modal navigation. The Copy page link action preserves direct navigation to the endpoint.

The visual system uses white backgrounds, near-black text, neutral dividers and blue/purple links. HTTP method badges retain restrained colour coding. See `doc/viewer-design.md` for the flows and acceptance criteria.

Optional capability `url` identifies the app route. `presentation.operationOrder` orders endpoints by use. `presentation.operations[operationId]` accepts `description`, a concise `behaviour` summary, additional `rules`, optional `ruleGroups` (`title`, `rules`) and `diagrams` (`title`, Mermaid `source`). `ruleTitles` supplies concise labels in search and check gaps. These are navigation and context; full source clauses remain authoritative. Operation and rule references are validated.

Mermaid fences in the behaviour/system document and endpoint diagrams render as monochrome SVG. The bundled Mermaid runtime also works offline in the exported HTML. Diagram source stays available on demand; invalid diagrams show an error without blocking the rest of the page. The CLI validates diagram metadata, not Mermaid syntax; renderer tests and preview review establish diagram validity.

`bive build --out ./bive-preview` creates a portable `viewer.html` that can be opened without a server. In the live viewer, attachments save to `bive/visuals.yaml` and `bive/assets`. In an exported snapshot, attachments stay in that preview; **Save preview** downloads a self-contained copy with them. Edit the source files to change normative contract text.

## Verification semantics

Unchecked, passing, failing and stale are distinct. Node checks require exact expected test names and structured results; missing/skipped tests fail. Evidence includes commands, exit status, timings, observed tests and a SHA-256 digest of specs plus explicitly tracked sources. Failures are recorded. Checks execute sequentially, with a timeout.

BIVE validates payload schemas and examples and its own cross-references; this is a bounded contract validator, not a complete OpenAPI standards validator. V0 supports OpenAPI 3.1 with local refs. Interfaces can originate in Zod, Protobuf tooling or handwritten OpenAPI, but only OpenAPI is consumed in this version. Optional type generation remains with the app’s chosen generator.

A linked passing test is evidence for a rule, not proof of all its cases. Prompt-text tests do not establish live AI behaviour. Runtime permissions, races and retry behaviour require meaningful app tests. No paid evaluation is invoked by the pilot.

Browser editing of normative contract text, type generation, remote schema refs and hosted collaboration are deferred.

## Develop

Node 22+. `npm install`, `npm test`, `npm pack`. The CLI and viewer run directly from source; no build step is needed. Dependencies: yaml, Ajv, ajv-formats. The viewer uses platform DOM APIs and escapes source content.

## Visual references

Attach a screenshot, design image/PDF or HTTPS design link to a feature, endpoint, request, response, shared object, individual field, scenario, rule or check. The small Add visual action opens an inline form. Field/object actions appear on hover or keyboard focus; existing visuals remain visible beside their target. Supported files: PNG, JPEG, WebP, GIF and PDF, up to 8 MB. Design links open their source rather than loading an embedded design app. The metadata format is in the bundled format reference.

Collapsed object fields show a pale-yellow `{...}`; optional markers, nullability, arrays and constraints remain visible. Expand in place to inspect their fields.

## Compact agent context

```sh
bive context
bive context --capability daily --operation tap --stats
bive context --capability daily --operation tap --section request,response
bive context --capability daily --rule DAILY-PLAY-4
bive context --capability daily --schema DailyPlayView
```

Packets are assembled in code, not summarised by a model. Rule text and failure semantics remain exact. Nested types and grouped rules are explicit references, payload examples are fetched separately, and check summaries retain freshness. Image bytes, Mermaid's runtime, repeated OpenAPI examples and raw execution logs never enter these packets. The default 12,000-character budget fails visibly if exceeded; it never silently truncates rules. This reduces input context size; actual tokens and billed cost depend on the model and subsequent reads. See [context-design.md](doc/context-design.md) for research, limitations and measurements.

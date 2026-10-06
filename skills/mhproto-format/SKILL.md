---
name: mhproto-format
description: Reference for MHProto contract files (mhproto.yaml, rules, interfaces, examples, checks, visuals, plugins). Read before creating or editing MHProto files; the other mhproto skills link here.
---

# MHProto file format

`mhproto.yaml` uses version: 1, name, system (Markdown path), optional presets and plugins, and capabilities.
Each capability has id (lowercase slug) and spec (Markdown). Everything else is optional: title, description, owner, gaps, url, interface or interfaces, examples (YAML), checks (YAML) and sources (tracked implementation files/directories). A missing part is treated as empty; `mhproto check` still reports rules without checks.
All paths are relative to the application root and cannot escape it through symlinks.

`interface: path` is shorthand for `interfaces: [{ adapter: openapi, file: path }]`. Each entry of `interfaces` names an adapter and a file or directory, with optional adapter `options`; list each adapter once per capability. Adapters come from plugins. With no `presets` key the `recommended` preset loads the built-in `openapi` plugin; `presets: []` loads nothing. `plugins` entries are a built-in name, a project-relative module (`./tools/mhproto-sql.mjs`) or an npm package (`sql` resolves to `mhproto-plugin-sql`), optionally as `[name, options]`. Run `mhproto plugins` to see what is loaded.

Rules are Markdown bullets: `- **DAILY-PLAY-1** Behaviour statement.` Indented continuation lines belong to that rule. Link OpenAPI operations through `x-mhproto-rules: [DAILY-PLAY-1]`; existing `x-clauses` also works. `x-mhproto-links: [table:daily_plays]` records that an operation depends on another entity (`kind:id`, or `capability/kind:id` across capabilities); `check` fails on links to missing entities. Local JSON Schema references are supported. Remote references and OpenAPI 3.0 are not supported in V0. Types stay in the established schema source.

Interfaces become entities: OpenAPI gives `operation` (by operationId) and `schema` (by component name); plugins add their own kinds. Every entity has a kind, an id, rule links and optional links to other entities.

An examples.yaml file has an `examples` array. Each entry has id, title, rules (rule IDs), operations (operationIds), given, when and then. Optional request: {operation, body} and response: {status, body} payloads are schema-checked; rejected input scenarios describe the invalid payload in prose instead of claiming it conforms.

A checks.yaml file has a `checks` array. Each entry has id, title, rules, examples, files and command (argv array), optional description, env and timeoutMs. Commands execute from the app root without a shell, with the inherited environment plus configured env. They are not sandboxed; run verification only in repositories whose check commands you trust. timeoutMs must be a positive integer (default 60,000).
For Node’s runner, use runner: node-test, exact testNames, and command: [node, --import, tsx, --test, --test-reporter, "{mhprotoNodeReporter}", relative/test.ts]. Add --test-name-pattern when useful. The reporter requires completed passing events for exact test names, rejects skipped/TODO/missing tests, and fails closed on malformed or oversized (1 MB) structured output. Include test files in tracked sources.

Evidence is local in .mhproto/evidence/<capability>.json and carries a digest of the contract and tracked implementation. Inputs include mhproto.yaml, the system document, capability files, interface files, tracked sources and declared check files. It becomes stale when an input changes. A passing command is evidence, not a proof of requirements correctness or complete coverage.

`mhproto snapshot` stores .mhproto/baseline.json. `mhproto diff` compares rules, entities (operations, schemas and plugin kinds), examples and checks. Contract snapshots contain app documentation; review before sharing.

Visual references are optional in `mhproto/visuals.yaml`, as a `visuals` array. Each entry has id, title, kind (screenshot/design), target and one of file (local image/PDF) or url (HTTPS design link). Optional mime, caption and sha256 describe the file. Targets have capability and kind: feature; operation/request/response plus operation id; schema plus schema name; example/rule/check plus id; or any plugin entity kind plus its id. Response targets also specify status. Field targets have operation id, scope (request/response), JSON-pointer path and response status when applicable. Request paths start at /body, /path, /query, /header or /cookie; response paths start at the body. Use `*` for array items, for example /rounds/_/answers/_/text. Uploaded files live in mhproto/assets. Treat visuals as references, not new normative rules; conflicting designs require a stated contract decision.

`mhproto context` emits a compact feature index. `--capability ID --operation ID` retrieves an endpoint packet with exact directly linked rules, semantic preconditions, error codes, root request/response structures, scenario summaries, check status and visual metadata. `--entity KIND:ID` retrieves any entity, such as `--entity table:daily_plays`, with its definition, links, rules, examples, checks and visuals. Nested schema refs and named rule groups are deferred explicitly. `--schema NAME`, `--rule ID`, `--example ID`, `--check ID` or `--visual ID` retrieves detail. `--section` limits fields to a comma-separated list; an unknown section lists the available ones. A 12,000-character default budget fails with refinement guidance rather than truncating; increase --max-chars deliberately. Evidence freshness is retained, while full execution logs and image bytes are excluded. --stats reports text sizes on stderr, not model token counts.

# BIVE V0 file format

`bive.yaml` uses version: 1, name, system (Markdown path), and capabilities.
Each capability has id (lowercase slug), title, spec (Markdown), interface (OpenAPI 3.1 JSON/YAML), examples (YAML), checks (YAML), sources (tracked implementation files/directories), optional owner, description and gaps.
All paths are relative to the application root and cannot escape it through symlinks.

Rules are Markdown bullets: `- **DAILY-PLAY-1** Behaviour statement.` Indented continuation lines belong to that rule. Link OpenAPI operations through `x-bive-rules: [DAILY-PLAY-1]`; existing `x-clauses` also works. Local JSON Schema references are supported. Remote references and OpenAPI 3.0 are not supported in V0. Types stay in the established schema source.

An examples.yaml file has an `examples` array. Each entry has id, title, rules (rule IDs), operations (operationIds), given, when and then. Optional request: {operation, body} and response: {status, body} payloads are schema-checked; rejected input scenarios describe the invalid payload in prose instead of claiming it conforms.

A checks.yaml file has a `checks` array. Each entry has id, title, rules, examples, files and command (argv array), optional description, env and timeoutMs. Commands execute from the app root without a shell.
For Node’s runner, use runner: node-test, exact testNames, and command: [node, --import, tsx, --test, --test-reporter, "{biveNodeReporter}", relative/test.ts]. Add --test-name-pattern when useful. The reporter ensures exact required tests actually ran and passed. Include test files in tracked sources.

Evidence is local in .bive/evidence/<capability>.json and carries a digest of the contract and tracked implementation. It becomes stale when an input changes. A passing command is evidence, not a proof of requirements correctness or complete coverage.

`bive snapshot` stores .bive/baseline.json. `bive diff` compares rules, operations, schemas, examples and checks. Contract snapshots contain app documentation; review before sharing.

Visual references are optional in `bive/visuals.yaml`, as a `visuals` array. Each entry has id, title, kind (screenshot/design), target and one of file (local image/PDF) or url (HTTPS design link). Optional mime, caption and sha256 describe the file. Targets have capability and kind: feature; operation/request/response plus operation id; schema plus schema name; example/rule/check plus id. Response targets also specify status. Field targets have operation id, scope (request/response), JSON-pointer path and response status when applicable. Request paths start at /body, /path, /query, /header or /cookie; response paths start at the body. Use `*` for array items, for example /rounds/*/answers/*/text. Uploaded files live in bive/assets. Treat visuals as references, not new normative rules; conflicting designs require a stated contract decision.

`bive context` emits a compact feature index. `--capability ID --operation ID` retrieves an endpoint packet with exact directly linked rules, semantic preconditions, error codes, root request/response structures, scenario summaries, check status and visual metadata. Nested schema refs and named rule groups are deferred explicitly. `--schema NAME`, `--rule ID`, `--example ID`, `--check ID` or `--visual ID` retrieves detail. `--section request,response,behaviour,errors,examples,checks,visuals,sources` limits fields. A 12,000-character default budget fails with refinement guidance rather than truncating; increase --max-chars deliberately. Evidence freshness is retained, while full execution logs and image bytes are excluded. --stats reports text sizes on stderr, not model token counts.

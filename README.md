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
| inspect | Emit the normalised project model as JSON |
| verify | Run linked argv commands, store revision-bound evidence |
| view | Serve a read-only viewer on loopback; auto-refresh source changes |
| snapshot / diff | Save a baseline and inspect contract changes |
| build | Export viewer assets, model.json and a self-contained viewer.html |

Use `--root PATH` for another app. See `bive help` for command options and `skills/bive-specify/references/format.md` for the data format.

## Viewer

The viewer starts with behaviour and four task-focused views: Behaviour, API, Checks and Changes. Open a rule to follow its examples, endpoints and evidence in a detail panel with Back navigation. Checks start with missing, failing or stale evidence. Nested types, raw schemas, commands and source metadata are revealed on demand.

The visual system uses white backgrounds, near-black text, neutral dividers and blue/purple links. See `doc/viewer-design.md` for the flows and acceptance criteria.

Optional capability `presentation` metadata controls `entrySection`, `sectionTitles` and `ruleTitles`. These are navigation labels and concise summaries; the full source rule remains authoritative in its detail view.

`bive build --out ./bive-preview` creates a portable `viewer.html` that can be opened without a server. The live viewer stays read-only; edit the source files to update the contract.

## Verification semantics

Unchecked, passing, failing and stale are distinct. Node checks require exact expected test names and structured results; missing/skipped tests fail. Evidence includes commands, exit status, timings, observed tests and a SHA-256 digest of specs plus explicitly tracked sources. Failures are recorded. Checks execute sequentially, with a timeout.

BIVE validates payload schemas and examples and its own cross-references; this is a bounded contract validator, not a complete OpenAPI standards validator. V0 supports OpenAPI 3.1 with local refs. Interfaces can originate in Zod, Protobuf tooling or handwritten OpenAPI, but only OpenAPI is consumed in this version. Optional type generation remains with the app’s chosen generator.

A linked passing test is evidence for a rule, not proof of all its cases. Prompt-text tests do not establish live AI behaviour. Runtime permissions, races and retry behaviour require meaningful app tests. No paid evaluation is invoked by the pilot.

Browser editing, type generation, remote schema refs and hosted collaboration are deferred.

## Develop

Node 22+. `npm install`, `npm test`, `npm pack`. The CLI and viewer run directly from source; no build step is needed. Dependencies: yaml, Ajv, ajv-formats. The viewer uses platform DOM APIs and escapes source content.

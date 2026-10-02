---
name: bive-implement
description: Implement an agreed BIVE contract in a project while preserving its interfaces and behaviour. Use when the user requests implementation of a specified capability or change.
---

# Bive Implement

Start with `bive context` for the feature index, then `bive context --capability ID --operation ID` for the affected endpoint. Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `bive inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read AGENTS.md, the capability spec, interface schemas, examples and checks. Confirm unresolved decisions do not affect the requested work; surface contradictions rather than inventing requirements.

Implement the requested delta, following the existing schema source and app conventions. Coordinate consumers/providers through the shared interface. Do not silently change the contract to fit the implementation; propose necessary contract changes explicitly.

Keep application tests in their normal locations. Reference rule and example IDs in relevant tests. Use ../bive-specify/references/format.md when editing links. Run `bive check`, the required app checks and `bive verify --capability ID`. Report gaps separately from passing checks.

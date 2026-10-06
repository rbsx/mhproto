---
name: mhproto-implement
description: Implement an agreed MHProto contract in a project while preserving its interfaces and behaviour. Use when the user requests implementation of a specified capability or change.
---

# MHProto Implement

Start with `mhproto context` for the feature index, then `mhproto context --capability ID --operation ID` for the affected endpoint (or `--entity KIND:ID` for other interface entities). Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `mhproto inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read AGENTS.md, the capability spec, interface schemas, examples and checks. Confirm unresolved decisions do not affect the requested work; surface contradictions rather than inventing requirements.

Implement the requested delta, following the existing schema source and app conventions. Coordinate consumers/providers through the shared interface. Do not silently change the contract to fit the implementation; propose necessary contract changes explicitly.

Keep application tests in their normal locations. Reference rule and example IDs in relevant tests. Use ../mhproto-format/SKILL.md when editing links. Run `mhproto check`, the required app checks and `mhproto verify --capability ID`. Report gaps separately from passing checks.

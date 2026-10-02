---
name: bive-discover
description: Discover a capability in an existing app and produce source-backed BIVE behaviour, interface and example drafts. Use for adopting BIVE or inspecting a capability before specification work.
---

# Bive Discover

Start with `bive context` for the feature index, then `bive context --capability ID --operation ID` for the affected endpoint. Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `bive inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read the project’s AGENTS.md and authoritative product docs, then bive.yaml and the relevant capability. Inspect providers, consumers, existing schemas and tests. Reuse an existing OpenAPI 3.1 interface or its generator; do not invent a parallel schema.

Record behaviour as confirmed, inferred or unknown with source paths. Preserve existing approval provenance. Reverse-engineered code describes observations; it does not approve requirements. Surface disagreements with product docs. Bound discovery to the requested capability.

Write small capability drafts, numbered rules and representative examples, including a failure/recovery case. Leave missing checks and unknown decisions visible. Read ../bive-specify/references/format.md for the file model. Run `bive check` after changes. Do not alter application behaviour as part of discovery.

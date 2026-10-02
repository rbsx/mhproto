---
name: bive-discover
description: Discover a capability in an existing app and produce source-backed BIVE behaviour, interface and example drafts. Use for adopting BIVE or inspecting a capability before specification work.
---

# Bive Discover

Read the project’s AGENTS.md and authoritative product docs, then bive.yaml and the relevant capability. Inspect providers, consumers, existing schemas and tests. Reuse an existing OpenAPI 3.1 interface or its generator; do not invent a parallel schema.

Record behaviour as confirmed, inferred or unknown with source paths. Preserve existing approval provenance. Reverse-engineered code describes observations; it does not approve requirements. Surface disagreements with product docs. Bound discovery to the requested capability.

Write small capability drafts, numbered rules and representative examples, including a failure/recovery case. Leave missing checks and unknown decisions visible. Read ../bive-specify/references/format.md for the file model. Run `bive check` after changes. Do not alter application behaviour as part of discovery.

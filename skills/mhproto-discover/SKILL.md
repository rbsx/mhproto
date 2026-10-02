---
name: mhproto-discover
description: Discover a capability in an existing app and produce source-backed MHProto behaviour, interface and example drafts. Use for adopting MHProto or inspecting a capability before specification work.
---

# MHProto Discover

Start with `mhproto context` for the feature index, then `mhproto context --capability ID --operation ID` for the affected endpoint. Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `mhproto inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read the project’s AGENTS.md and authoritative product docs, then mhproto.yaml and the relevant capability. Inspect providers, consumers, existing schemas and tests. Reuse an existing OpenAPI 3.1 interface or its generator; do not invent a parallel schema.

Record behaviour as confirmed, inferred or unknown with source paths. Preserve existing approval provenance. Reverse-engineered code describes observations; it does not approve requirements. Surface disagreements with product docs. Bound discovery to the requested capability.

Write small capability drafts, numbered rules and representative examples, including a failure/recovery case. Leave missing checks and unknown decisions visible. Read ../mhproto-specify/references/format.md for the file model. Run `mhproto check` after changes. Do not alter application behaviour as part of discovery.

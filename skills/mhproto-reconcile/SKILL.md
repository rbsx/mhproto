---
name: mhproto-reconcile
description: Find and reconcile disagreements between MHProto specs, interface schemas, examples and application implementation. Use for contract drift or capability upkeep.
---

# MHProto Reconcile

Start with `mhproto context` for the feature index, then `mhproto context --capability ID --operation ID` for the affected endpoint (or `--entity KIND:ID` for other interface entities). Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `mhproto inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read repository authority/provenance and the capability. Run `mhproto check`, inspect stale evidence and review `mhproto diff` if a baseline exists. Inspect the relevant source and tests to distinguish missing checks, stale generated files, implementation bugs and changed product intent.

State each discrepancy with its rule ID and evidence. Fix deterministic tooling or generated-artifact drift within scope. When intent is uncertain, present the decision instead of treating code as automatically authoritative. Preserve existing approvals and human examples.

After the authorised resolution, update affected specs, schemas, examples and checks together. Run required app checks and `mhproto verify`. State remaining gaps. Read ../mhproto-format/SKILL.md for linking conventions.

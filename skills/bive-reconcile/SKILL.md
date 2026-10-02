---
name: bive-reconcile
description: Find and reconcile disagreements between BIVE specs, interface schemas, examples and application implementation. Use for contract drift or capability upkeep.
---

# Bive Reconcile

Read repository authority/provenance and the capability. Run `bive check`, inspect stale evidence and review `bive diff` if a baseline exists. Inspect the relevant source and tests to distinguish missing checks, stale generated files, implementation bugs and changed product intent.

State each discrepancy with its rule ID and evidence. Fix deterministic tooling or generated-artifact drift within scope. When intent is uncertain, present the decision instead of treating code as automatically authoritative. Preserve existing approvals and human examples.

After the authorised resolution, update affected specs, schemas, examples and checks together. Run required app checks and `bive verify`. State remaining gaps. Read ../bive-specify/references/format.md for linking conventions.

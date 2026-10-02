---
name: bive-implement
description: Implement an agreed BIVE contract in a project while preserving its interfaces and behaviour. Use when the user requests implementation of a specified capability or change.
---

# Bive Implement

Read AGENTS.md, the capability spec, interface schemas, examples and checks. Confirm unresolved decisions do not affect the requested work; surface contradictions rather than inventing requirements.

Implement the requested delta, following the existing schema source and app conventions. Coordinate consumers/providers through the shared interface. Do not silently change the contract to fit the implementation; propose necessary contract changes explicitly.

Keep application tests in their normal locations. Reference rule and example IDs in relevant tests. Use ../bive-specify/references/format.md when editing links. Run `bive check`, the required app checks and `bive verify --capability ID`. Report gaps separately from passing checks.

---
name: bive-specify
description: Create or revise a BIVE capability contract before implementing a feature. Use for agreement on behaviour, interfaces, examples and verification expectations.
---

# Bive Specify

Start with `bive context` for the feature index, then `bive context --capability ID --operation ID` for the affected endpoint. Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `bive inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read authoritative repository docs and the current capability. Preserve the user’s scope and established decisions. Read references/format.md.

Run `bive snapshot` before the first change if no baseline exists; do not replace an existing baseline without intent. Propose precise numbered rules, permissions, state transitions, failure/recovery behaviour and concrete examples. Link interfaces to rule IDs. Reuse the app’s schema source/generator rather than editing generated OpenAPI by hand.

Separate intended behaviour from observed implementation and unresolved decisions. Identify affected providers/consumers and compatibility consequences. Present the contract delta with `bive diff`; resolve decisions that affect implementation with the user, without asking them to reconfirm previously agreed behaviour.

Run `bive check`. Unbound rules stay visibly unchecked. Changing a spec is not evidence that the app implements it.

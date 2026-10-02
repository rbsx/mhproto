---
name: mhproto-verify
description: Write and run MHProto checks linked to agreed behaviour and examples, and inspect evidence gaps. Use for verifying a capability or adding contract-based tests.
---

# MHProto Verify

Start with `mhproto context` for the feature index, then `mhproto context --capability ID --operation ID` for the affected endpoint. Load only relevant `--rule`, `--schema`, `--example` or `--check` detail; `--section` narrows a packet. Read every deferred rule group the change touches before editing. Inspect the authoritative source when deciding intent or making a change. Do not load the exported HTML or whole `mhproto inspect` model into the prompt. Visual packets contain references; open images/design links only when needed.

Read the agreed rules and examples before implementation details. Derive assertions from observable outcomes, not private helper structure. Cover the requested failure/recovery paths and preserve human-provided examples as the test oracle.

Keep tests in the existing runner. Link each check to precise rules/examples and an argv command in checks.yaml. For Node tests, use the structured reporter and exact testNames; skipped, TODO or missing tests must fail verification. Generic command success proves only that command passed. Label prompt-text checks separately from live model evaluation.

Use ../mhproto-specify/references/format.md. Run `mhproto check` then `mhproto verify --capability ID`. Inspect failures and the report, including freshness and missing test names. Do not claim all linked behaviour is proven, or run paid/live-production checks unless those actions are in scope. Do not rewrite the spec to make a failing implementation pass.

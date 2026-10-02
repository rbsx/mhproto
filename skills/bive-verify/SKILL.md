---
name: bive-verify
description: Write and run BIVE checks linked to agreed behaviour and examples, and inspect evidence gaps. Use for verifying a capability or adding contract-based tests.
---

# Bive Verify

Read the agreed rules and examples before implementation details. Derive assertions from observable outcomes, not private helper structure. Cover the requested failure/recovery paths and preserve human-provided examples as the test oracle.

Keep tests in the existing runner. Link each check to precise rules/examples and an argv command in checks.yaml. For Node tests, use the structured reporter and exact testNames; skipped or missing tests must fail verification. Generic command success proves only that command passed. Label prompt-text checks separately from live model evaluation.

Use ../bive-specify/references/format.md. Run `bive check` then `bive verify --capability ID`. Inspect failures and the report, including freshness and missing test names. Do not claim all linked behaviour is proven, or run paid/live-production checks unless those actions are in scope. Do not rewrite the spec to make a failing implementation pass.

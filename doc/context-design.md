# Context design

Keep MHProto useful to people in the viewer, and small for agents at its retrieval boundary. Collapsing browser content alone does not reduce tokens: an agent must request a smaller packet.

## Established patterns

[Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) recommends high-signal context, just-in-time retrieval through references, and progressive disclosure. Applied here: a feature index first, then selected endpoint, rule, schema or example detail. The contract remains in authoritative files rather than a giant always-loaded prompt.

[Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) describes discovering interfaces on demand and filtering/transforming results in code before passing them to a model. Applied here: deterministic CLI packets, deduplicated error schemas, scenario/check summaries and image metadata. No model call is needed to assemble them.

[OpenAI: Harness engineering](https://openai.com/index/harness-engineering/) describes short agent instructions as a map into structured repository documentation, with progressive disclosure and mechanical validation. Applied here: concise installable skills, explicit deferred references, linked checks and revision-bound evidence.

These are architecture patterns. Provider examples are not measurements of MHProto or a guarantee of our savings.

## Retrieval flow

1. `mhproto context` identifies the feature and endpoint.
2. `mhproto context --capability daily --operation tap` supplies the endpoint contract.
3. Fetch needed `--schema`, `--rule`, `--example` or `--check` detail. Read deferred groups before changing their behaviour.
4. Fetch `--visual ID` metadata and open its image/design only if it helps the task.
5. Inspect authoritative implementation/docs and run required checks for the change.

Optional `--section` narrows a packet. The default 12,000-character output budget raises an actionable error rather than dropping trailing rules. `--stats` writes character and byte counts to stderr. No token count is assumed.

Root structures preserve constraints, required fields, nullability and refs. Nested schemas are retrieved by name; grouped rules retain their IDs and an explicit instruction to fetch them. Exact rule text, semantic preconditions and error codes remain intact. Larger concrete payload examples are available through --example. Check summaries keep stale/failing/unchecked states; verbose runner logs do not enter the endpoint packet. Images are stored separately, never as base64 inside the project model or context output.

## Pilot measurement

Measured against the same fresh Impostor daily project on 2026-10-02. Compact JSON, excluding its trailing newline. See context-measurements.json.

| Read | Characters | Bytes |
| --- | ---: | ---: |
| Complete normalized project model | 129,642 | 129,766 |
| Feature/operation index | 980 | 980 |
| Tap endpoint packet | 8,501 | 8,505 |
| Tap request/response only | 1,914 | 1,914 |
| Ask endpoint packet | 9,279 | 9,281 |

The tap packet is 93.44% smaller in characters than the complete model because it retrieves a different, relevant scope. This is not equivalent-content compression or a measured billing reduction. Model tokenization, follow-up reads, implementation files, retries and any opened images affect total consumption. Fetching every reference may approach or exceed a full read. Avoid summarizing away constraints just to improve this metric.

## Current boundary

This version supplies an on-demand CLI boundary and retrieval instructions. It does not intercept every agent tool call, enforce a model session token budget or implement provider prompt caching. Contract text still changes through repository files. Image interpretation remains an explicit agent action; no image analysis service runs automatically.

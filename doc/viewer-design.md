# BIVE viewer design

Start with the feature the developer is working on, its app route, and the data exchanged to implement it.

## Structure

- Sidebar: [b] logo, Project → Impostor, Features → Daily case (blue link). Sources stays in the sidebar footer.
- Search at the top of every page.
- Feature overview: title, product/logic description, relative URL, API visible by default, play-state diagram, then Checks.
- Endpoint page: back to the feature, method/path, purpose, copyable page link, inline request/response types, attached behaviour, useful diagrams, errors, examples and Checks.
- Check and Sources links open pages. No tabs or modals.

## Reading flow

Read what the page loads and shows. Scan the endpoints in client-use order. Read request/response objects beside each endpoint; open it for complete behaviour and failures. Expand a nested object in place when its fields matter. Follow a rule or check through a stable URL.

Passing checks and rules without checks are compact disclosures below the API. Failures, unchecked results and stale results are surfaced directly. Full commands and raw payloads stay deferred.

## Diagrams

Use Mermaid for state transitions, UI decisions, start/retry idempotence, action races and delayed public reveal. Avoid diagrams that repeat a trivial request/response. Mermaid fences and endpoint diagrams render using the bundled runtime, with white fills, black text and neutral lines. Source is available separately. Invalid syntax must not prevent reading the page.

The pilot uses six diagrams: play states, page-loading branches, retrying a start, overlapping actions, tap eligibility/transitions, and public reveal timing.

## Visual system

White background, near-black text, neutral separators. Blue links and purple visited links. Colour accents are limited to HTTP methods, focus and errors. Signature fields stay inline; no separate shared-type catalogue.

## Acceptance

- Search is the first main-page control; the project and feature are clear in the sidebar.
- Daily case describes real client behaviour and shows /daily.
- API and object signatures are visible without opening a tab or accordion.
- Every endpoint has a directly loadable URL; Back returns to the feature.
- Behaviour is attached to endpoints, including privacy, preconditions and failures.
- Nested fields expand in context, with nullable/optional distinctions retained.
- Checks appear below API, with freshness and coverage limits clear.
- Flow, state and sequence diagrams render, including loops and branching.
- A broken diagram retains its source and does not break navigation.
- Responsive layout stacks request/response objects on narrow screens.

DOM tests cover navigation and actual Mermaid SVG rendering using simulated text measurements. Visual browser QA remains blocked by this session’s file/localhost restrictions.

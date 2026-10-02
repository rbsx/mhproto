# BIVE viewer design

Start with the feature the developer is working on, its app route, and the data exchanged to implement it.

## Structure

- Sidebar: [b] logo, Project → Impostor, Features → Daily case (blue link). Sources stays in the sidebar footer.
- Search at the top of every page.
- Feature overview: title, product/logic description, relative URL, API visible by default, play-state diagram, then Checks.
- Endpoint page: back to the feature, method/path, purpose, copyable page link, inline request/response types, attached behaviour, useful diagrams, errors, examples and Checks.
- Type names, Check and Sources links open pages. No tabs or modals.

## Reading flow

Read what the page loads and shows. Scan the endpoints in client-use order. Read request/response objects beside each endpoint; open it for complete behaviour and failures. Expand a nested object in place when its fields matter. Follow a rule or check through a stable URL.

Passing checks and rules without checks are compact disclosures below the API. Failures, unchecked results and stale results are surfaced directly. Full commands and raw payloads stay deferred.

## Diagrams

Use Mermaid for state transitions, UI decisions, start/retry idempotence, action races and delayed public reveal. Avoid diagrams that repeat a trivial request/response. Mermaid fences and endpoint diagrams render using the bundled runtime, with white fills, black text and neutral lines. Source is available separately. Invalid syntax must not prevent reading the page.

The pilot uses six diagrams: play states, page-loading branches, retrying a start, overlapping actions, tap eligibility/transitions, and public reveal timing.

## Visual system

White background, near-black text, neutral separators. Blue links and purple visited links. Colour accents are limited to HTTP methods, focus, errors and pale-yellow expandable object placeholders. Signature fields stay inline. Type names link to definitions and usage backlinks; no separate shared-type catalogue.

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

## Visual attachment flow

Use the single `+` after a feature/endpoint description, scenario, rule or check text block, or directly alongside a Request/Response header. Attach one image/PDF or design link, give it a descriptive title and optionally note the state or source. The result appears beneath that block/header. Object signatures, nested fields and Path/JSON-body labels do not offer attachment actions. Existing field/shared-object references are displayed beneath the matching header with their field path or type name; their metadata is retained.

The workspace viewer writes files and metadata to the app. The exported preview keeps added visuals in memory until Save preview downloads the amended HTML. The footer and save action communicate that state. Existing attachments are embedded when exporting; their bytes live in a separate registry, outside the project model and agent context packets. Images load lazily; external design apps are linked instead of embedded.

Collapsed objects show only `{...}` in pale yellow. Keep optional markers and nullable/array types alongside it. Do not squeeze nested keys into that placeholder.

## Attachment ownership (0.4.1)

One component owns the text/header, its single creation button, a read-only gallery and its editor. An explicit placement policy permits only text blocks and Request/Response headers to create controls. A page-scoped target registry gives repeated semantic targets one editing owner. The schema renderer has no attachment API or project/media dependency.

Hover and keyboard focus styles address the creation button directly inside its text/header zone. They do not use API-column, field, gallery or ancestor-section hover selectors. Zones do not nest. This prevents hovering over a field from revealing a header action or multiple schema actions.

Regression checks reproduce a request with path parameters plus a shared JSON-body schema, a response with nested shared objects, expanded fields and reused types. They assert one creation control per header, none inside signatures, one matching hover action on a text/header zone and none on fields/columns. Repeated rule targets retain one owner. Existing field/type visuals stay accessible under the header. Cancel restores keyboard focus to the original control. DOM/CSS selector tests do not claim painted browser layout validation.

## Type reading flow (0.5)

Read `GetTodayQuery { date: string; deviceId: string; }` below Request → Query and `DailyTodayResponse { ... }` below Response. Nested `case` and `play` fields show clickable `DailyCaseView` and `DailyPlayState` names beside their pale-yellow `{...}` expanders. Array items and named enum types are linked too. Keep required/optional markers, nullability and constraints visible.

Follow a name to its definition page. Used in links back to every feature overview and endpoint whose request or response includes the type, including nested uses. Referenced by types links to other definitions containing it. Endpoint links include the request part or response status. The copy action and URL make the page shareable; search finds types as well. No type catalogue is added to navigation.

The index is a separate logical layer from schema rendering and attachment ownership. Source identity uses the interface file and type/declaration id, not structural similarity or just the name. Anonymous structures get deterministic viewer labels with an explicit source note; they do not become new normative schemas. Recursive type relationships stop at visited identities. The index stays in memory and is regenerated for a new model, rather than expanding the serialized model or agent context.

Acceptance: existing type names are preserved; root/nested fields link; generated labels resolve to the exact inline structure; required/optional markers survive; every use has an endpoint and overview backlink; incoming type links are present; shared interfaces link across features while unrelated homonyms stay separate; recursive schemas terminate; direct links, search, standalone export and the single-attachment-owner rules keep working.

## Iteration review (0.6)

Keep the reading view unchanged until the reader enters Changes. Its sidebar link shows a compact item count when a baseline exists. The Changes page identifies the baseline, shows added/changed/removed counts, and lists only changed items grouped by feature. A category dropdown narrows the list. No modal or raw project dump is introduced.

Choose a snapshot JSON/earlier preview, or use the current spec as the iteration baseline. Open a change for a Before/Now table containing only changed fields. Open its current endpoint/type/feature/check page with comparison highlights enabled. Keep named type links and nested field expansion; show added/changed/removed field labels and changed item badges. Use words with pale green/yellow/red accents so colour is not the only signal. Hide highlights restores ordinary reading and preserves a rule deep link. Removed items retain their old definition on their change page.

Diff computation is separate from rendering, type indexing and attachment ownership. The same semantic comparator runs in CLI/server/browser. Stable change identities use capability, kind and entity id, never row positions. A saved baseline is a detached snapshot; updates to live visuals cannot silently alter it. Metadata/evidence churn stays outside the comparator. No attachment controls appear in comparison pages or object fields. Type pages still provide affected-endpoint backlinks for indirect schema changes.

The live viewer refreshes both model and baseline; a file selected by the reader stays local to that viewer. Explicit --against comparisons are protected from the baseline reset action. Standalone exports embed their baseline and work offline; Save preview retains a new/selected baseline alongside visual attachments. Earlier HTML imports are parsed as inert model data. Invalid imports keep the prior comparison and show an inline error.

Acceptance: compare additions/changes/removals, including required/nullable/constraint edits; retain removed definitions; link to current pages and preserve comparison URLs; omit evidence/key-order/set-order noise; keep null distinct from absence; support legacy/new JSON snapshots and earlier HTML previews; preserve baseline on invalid files; save/reload offline with no network request; keep one attachment owner per text/header.

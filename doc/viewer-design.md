# BIVE viewer design

The viewer helps a developer understand and change a capability without reading a report of every artifact. The first screen should establish purpose and behaviour. Each deeper level answers a specific follow-up question.

## Primary flows

| Intent | Entry | Next step | What stays deferred |
| --- | --- | --- | --- |
| Understand this capability | Purpose, phases, grouped behaviour rules | Open one rule | Types, commands, evidence logs |
| Understand one rule | Rule detail | Related examples, endpoints and checks | Unrelated capability information |
| Integrate a client/provider | API list | Endpoint parameters, request/response fields and errors | Nested types, JSON and other endpoints |
| Find what needs work | Checks, attention first | Missing rule or failing/stale check | Passing check inventory and raw output |
| Review a proposed change | Changes list | Before/after of one item | Entire before/after documents |

## Information hierarchy

Navigation: Behaviour, API, Checks, Changes. Examples belong beside their rules. Sources and system map are secondary tools.

The initial daily-case view expands gameplay only. Other behaviour groups are collapsed. A contextual detail panel preserves the underlying view, supports following related items, and offers Back. Search finds rules, endpoints, examples and checks across the capability.

Verification language describes observed checks, not universal proof. Missing checks and stale evidence remain visible in the Checks flow. No passing percentage or dashboard cards appear on the default view.

## Visual system

White background, near-black text, light neutral dividers. Blue links and purple visited links. Colour is reserved for links, keyboard focus and exceptional errors. Native system typography; generous spacing; no tinted cards or decorative status colours.

## Acceptance

- A reader can explain the capability before opening metadata.
- A rule leads directly to its examples, interfaces and evidence.
- Passing checks do not obscure missing/failing/stale checks.
- Raw JSON, test commands and source prose are closed by default.
- Detail navigation preserves context and supports Back.
- Keyboard users can reach every control and see focus.
- Mobile layout keeps primary navigation and readable content.

This revision is a reviewable design prototype. DOM flow tests provide interaction evidence; visual browser QA remains limited by the session’s browser/file and localhost restrictions.

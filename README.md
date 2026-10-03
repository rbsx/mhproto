<div align="center">

# MHProto

**Describe a feature's behaviour, API and checks in your repo.<br>Review it in a browser. Give your coding agent exactly the part it needs.**

For developers using Claude Code, Codex and other coding agents on existing projects.

[![npm (next)](https://img.shields.io/npm/v/mhproto/next?label=npm%40next&color=cb3837)](https://www.npmjs.com/package/mhproto)
[![CI](https://github.com/rbsx/mhproto/actions/workflows/check.yml/badge.svg)](https://github.com/rbsx/mhproto/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2458ca)](LICENSE)

[**Live demo**](https://mhproto.dev/demo/) · [How it works](doc/how-it-works.md) · [Docs](https://mhproto.dev/docs/)

<a href="https://mhproto.dev/#walkthrough"><img src=".github/assets/walkthrough.gif" width="100%" alt="42-second walkthrough of MHProto. The same rule ID links a feature's Markdown rules, OpenAPI operation, example and test. The browser viewer shows the feature, an endpoint page, a type page listing every endpoint that uses it, and the changes since the last snapshot. The terminal prints the compact context packet an agent reads for one endpoint. The viewer then shows 10 of 10 linked checks passing. The video ends with npm install -D mhproto@next."></a>

</div>

## What you get

- **Describe:** numbered rules, your OpenAPI 3.1, examples and checks as plain files, linked by rule ID.
- **Review:** linked pages for every feature, endpoint and type, plus what changed since the last snapshot.
- **Hand off:** your agent gets one endpoint's exact rules, types, errors and check status.
- **Verify:** run the linked tests and see which checks pass, fail or are stale, and which rules have none.

Local files and a CLI: no hosted service, no account and no AI calls.

## Quick start

```sh
npm install -D mhproto@next        # Node 22+
npx mhproto init --agent claude    # or --agent codex, or --agent all
npx mhproto view                   # serves http://127.0.0.1:4317
```

Replace the generated example with one real feature, or ask your agent to _"use mhproto-discover
to draft a contract for one feature"_.

**Next:** [How it works](doc/how-it-works.md) follows one feature end to end, with real files and
output. The [reference guide](https://mhproto.dev/docs/reference/) covers every command.

---

`0.8.0-preview.0` · development preview · [Feedback](https://github.com/rbsx/mhproto/issues) ·
[Contributing](CONTRIBUTING.md) · [MIT](LICENSE) ([third-party notices](THIRD_PARTY_NOTICES.md))

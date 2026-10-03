<div align="center">

# MHProto

**Put the contract first. See what a feature does, its API and its checks before agents build it,<br>and keep it visible as the code changes.**

For teams building with Claude Code, Codex and other coding agents, especially full-stack features where frontend and backend share an API.

[![npm (next)](https://img.shields.io/npm/v/mhproto/next?label=npm%40next&color=cb3837)](https://www.npmjs.com/package/mhproto)
[![CI](https://github.com/rbsx/mhproto/actions/workflows/check.yml/badge.svg)](https://github.com/rbsx/mhproto/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2458ca)](LICENSE)

[**Live demo**](https://mhproto.dev/demo/) · [How it works](doc/how-it-works.md) · [Docs](https://mhproto.dev/docs/)

<a href="https://mhproto.dev/#walkthrough"><img src=".github/assets/walkthrough.gif" width="100%" alt="42-second walkthrough of MHProto. The same rule ID links a feature's Markdown rules, OpenAPI operation, example and test. The browser viewer shows the feature, an endpoint page, a type page listing every endpoint that uses it, and the changes since the last snapshot. The terminal prints the compact context packet an agent reads for one endpoint. The viewer then shows 10 of 10 linked checks passing. The video ends with npm install -D mhproto@next."></a>

</div>

## What you get

- **See it:** every feature as linked pages: behaviour, endpoints, types, rules and examples. Product, design, frontend and backend read the same thing.
- **Change it early:** snapshot the contract, edit it, and review what changed before any code moves.
- **Keep it true:** checks link tests to rules, so you see what's passing, failing, stale or untested.
- **Hand it off:** your agent builds from the same contract, one endpoint at a time.

`npx mhproto build` exports the whole contract as one HTML file anyone can open. It all runs from
plain files in your repo: no hosted service, no account and no AI calls.

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

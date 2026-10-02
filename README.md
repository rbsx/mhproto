# MHProto

**A shared contract for humans and coding agents.**

MHProto (Machine–Human Protocol) keeps what your app should do alongside its API
definitions, examples and verification checks. Humans review the contract in a browser; coding agents use
the same source files to implement and verify it.

Everything lives in your repository. No hosted service or AI account is required.

## What it does

- **Agree on a feature:** keep Behaviour, Interface, Verification and Examples
  together—the BIVE approach.
- **Review it:** browse features, endpoints and linked types; attach design
  references and compare iterations.
- **Work with agents:** install five skills for Codex or Claude and retrieve
  scoped context for an endpoint, rule or type.
- **Verify it:** link checks to the contract and see passing, failing, unchecked
  and stale evidence.

## Try it locally

Development preview. Requires Node 22 or newer; the package is not published to npm.

```sh
git clone https://github.com/rbsx/mhproto.git
cd mhproto
npm ci
npm run check
```

Then, from your application's directory:

```sh
npm install --save-dev /path/to/mhproto
npx mhproto init --agent codex
npx mhproto view
```

Use `--agent claude` or `--agent all` for other skill layouts. Edit the generated
draft to describe your feature, then run `npx mhproto check`.

## Learn more

Visit the **[project website](https://mhproto.ignxt.chatgpt.site/)** for the overview,
demo and [documentation](https://mhproto.ignxt.chatgpt.site/docs/). The
[guide source](doc/guide.md) is also available in this repository.

For development, see [CONTRIBUTING.md](CONTRIBUTING.md). Current preview boundaries
and release gates are recorded in [the release review](doc/release-review.md).

MIT-licensed. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

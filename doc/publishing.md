# Publishing MHProto to npm

The library is public at https://github.com/rbsx/mhproto. The website lives in the
private `rbsx/mhproto-site` repository and deploys independently to https://mhproto.dev.

## Prepared preview — 2026-10-03

Version `0.8.0-preview.0` is configured for public access on the `next` dist-tag.
The package has not been published. The renderer's previous security gate is
cleared by a reproducible patched build; see [the release review](release-review.md).
This machine is not authenticated to npm, and `mhproto` returned E404 when checked.
An absent package is not a name reservation.

## 1. Prepare and test the exact archive

From a clean, committed library checkout with Node 22.12+ and Chromium installed:

```sh
npm ci
npx playwright install chromium
npm run release:prepare
```

This runs formatting/tests, root audit/signatures, a clean Mermaid rebuild and
notice verification, the exact bundled-version audit, build dependency audit,
desktop/mobile browser flows, and a fresh install of the generated tarball.
The installed CLI and HTTP/offline viewer are exercised from that consumer.

Outputs:

- `artifacts/release/mhproto-0.8.0-preview.0.tgz`
- `artifacts/release/release-manifest.json` with source commit, SHA-256, npm SHA-512
  integrity and full file list.
- `test-results/release/` browser screenshots.

Website source, build tools, tests, credentials and local project data are excluded.
Require all GitHub checks for the manifest's source commit to pass. Review that
archive and its manifest; publish those exact bytes. Preparation performs no
registry write.

## 2. Authenticate the package owner

Use an npm account with two-factor authentication enabled:

```sh
npm login
npm whoami
npm view mhproto name version dist-tags --json
```

E404 means no package was found; it does not guarantee the registry will accept
the name. If another owner has claimed it, choose an owned scope and update the
package metadata, archive and installation instructions before publishing.
Direct publication requires 2FA or a granular token configured to bypass 2FA;
interactive 2FA is suitable for this first manual release.

Source: [npm's public package publishing guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## 3. Publish the approved archive

After owner approval, current audit/name checks and green CI for the recorded
source commit, publish the tested archive:

```sh
npm audit
npm run audit:vendor
npm publish artifacts/release/mhproto-0.8.0-preview.0.tgz --access public --tag next
npm view mhproto@0.8.0-preview.0 version dist.integrity dist-tags --json
```

Complete npm's authentication/2FA prompt. Compare registry `dist.integrity` with
the release manifest, then test `npm install --save-dev mhproto@next` in another
fresh consumer. `next` keeps the preview explicit without making it `latest`.

Tag the manifest's exact commit as `v0.8.0-preview.0` and publish the release notes
only after registry verification. Update the private website's pinned library
commit and installation copy to `npm install -D mhproto@next`, then deploy it.
The source-preview copy remains accurate until publication succeeds.

## Later releases

Choose a new preview version, update root package/lock metadata, commit the reviewed
changes and repeat `npm run release:prepare`. Promote a reviewed stable version to
`latest` separately once preview feedback and supported-platform checks justify it.

For automation after the first publication, configure npm trusted publishing for
`rbsx/mhproto` and the exact GitHub release workflow filename. Use a GitHub-hosted
runner, `id-token: write`, aligned repository metadata and an explicit release
approval. Do not configure the private website as the npm publisher.
Trusted publishing uses OIDC instead of a stored npm token; supported public
repository releases can receive npm provenance automatically.

Source: [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

# Publishing MHProto to npm

The library is public at https://github.com/rbsx/mhproto. The website lives in the
private `rbsx/mhproto-site` repository and deploys independently to https://mhproto.dev.

## Published preview — 2026-10-03

Version `0.8.0-preview.0` is published publicly on npm. Both `next` and `latest`
currently point to this development preview; installation instructions use
`npm install -D mhproto@next`. The existing tags are retained for this first release.
The patched renderer and tested archive are documented in
[the release review](release-review.md).

The published archive's SHA-512 integrity matches the tested candidate exactly.
A fresh installation from npm passed CLI help and public API import checks.
The GitHub prerelease tag points to source commit
`1c3ea3f64f9afaf9ce565e3d09ba881881741998`, with the original tested tarball and
preparation manifest attached. The manifest describes preparation time; its
`published: false` field predates publication.

The steps below are for subsequent releases. Published archive bytes and the
release tag remain fixed. README corrections on the main branch and website are
live independently; npm's packaged README receives them with the next version.

## 1. Prepare and test the exact archive

Choose a new unpublished version and update root package/lock metadata before
preparing an archive. For example, the next preview would be:

```sh
npm version 0.8.0-preview.1 --no-git-tag-version
```

Commit the reviewed changes. From that clean library checkout with Node 22.12+
and Chromium installed:

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

- `artifacts/release/mhproto-VERSION.tgz` (using the new package version)
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

Confirm the signed-in account has publishing rights to `mhproto` and that the
chosen version is not already published. Never attempt to overwrite a released
version.
Direct publication requires 2FA or a granular token configured to bypass 2FA;
interactive 2FA is suitable for manual releases.

Source: [npm's public package publishing guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## 3. Publish the approved archive

After owner approval, current audits and version/ownership checks and green CI for the recorded
source commit, publish the tested archive:

```sh
npm audit
npm run audit:vendor
npm publish artifacts/release/mhproto-VERSION.tgz --access public --tag next
npm view mhproto@VERSION version dist.integrity dist-tags --json
```

Replace `VERSION` with the new version from the release manifest. Complete npm's
authentication/2FA prompt. Compare registry `dist.integrity` with
the release manifest, then test `npm install --save-dev mhproto@next` in another
fresh consumer. Publish subsequent previews on `next`; check the actual tags after
publication. The first preview also has `latest`, which remains as-is for now.
When a stable version is ready, move `latest` to that reviewed stable release and
keep future previews on `next`.

Tag the manifest's exact commit as `vVERSION` and publish the release notes
only after registry verification. Update the private website's pinned library
commit and installation copy to `npm install -D mhproto@next`, then deploy it.
Update release status and notes to describe the actual registry result.

## Later releases

Choose a new preview version, update root package/lock metadata, commit the reviewed
changes and repeat `npm run release:prepare`. Promote a reviewed stable version to
`latest` separately once preview feedback and supported-platform checks justify it.

For future automation, configure npm trusted publishing for
`rbsx/mhproto` and the exact GitHub release workflow filename. Use a GitHub-hosted
runner, `id-token: write`, aligned repository metadata and an explicit release
approval. Do not configure the private website as the npm publisher.
Trusted publishing uses OIDC instead of a stored npm token; supported public
repository releases can receive npm provenance automatically.

Source: [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

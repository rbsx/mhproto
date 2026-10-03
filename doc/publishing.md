# Publishing MHProto to npm

The public library repository is https://github.com/rbsx/mhproto. The website has
its own private repository, `rbsx/mhproto-site`, and deploys to https://mhproto.dev.
Run the steps below from the library checkout. Website deployment and npm
publication are independent.

## Current status — 2026-10-03

- `mhproto` returned npm E404 when checked: no published package was found.
  This is not a reservation; check again immediately before publishing.
- `npm whoami` returned ENEEDAUTH: this machine is not logged into npm.
- Package version is `0.7.0`; `private: true` prevents accidental publication.
- Hosted Linux/macOS, Node 22/24 checks, dependency audit/signature verification
  and desktop/mobile Chromium tests passed for commit `7d75f8b`.
- Mermaid's copied browser bundle is now verified against the official npm
  archive with its deterministic wrapper. The complete bundled license inventory
  remains open. An actual tarball consumer smoke remains to be completed after
  that gate. Windows has not been verified.

## 1. Finish the release review

The upstream identity part of the Mermaid gate is complete: the entire copied
bundle matches the official `mermaid@11.16.1` npm archive after the documented
local wrapper. Repeat the verification from the library checkout:

```sh
node scripts/verify-mermaid.mjs
```

It verifies the archive integrity, upstream and local hashes, MIT license and
59 exact bundled dependency versions. It does not change the runtime or publish
anything. Mermaid documents npm as an official distribution method:
[Mermaid usage](https://mermaid.js.org/config/usage).

To finish the remaining license part:

1. Use `viewer/vendor/bundled-packages.json` as the exact version list. It comes
   from the official bundle's source map, rather than a newly resolved dependency
   tree.
2. Download each listed package version with `npm pack <package>@<version>
--ignore-scripts`. Inspect its package license declaration and relevant
   LICENSE/COPYING/NOTICE files, plus inline third-party notices in the bundle.
3. Record the package/version, license identifier, archive integrity and notice
   source, and retain required license texts under `viewer/vendor/`. Account for
   every listed version, including duplicate package names at different versions.
4. Reference the reviewed notices in `THIRD_PARTY_NOTICES.md`, then mark
   `licenseInventoryComplete` in the vendor manifest. Update the release review
   evidence. Re-run viewer tests if the renderer bytes change.

The complete steps and verification scope are also recorded in
`viewer/vendor/README.md`. The [release review](release-review.md) still blocks an
npm release until the license review and clean consumer installation pass.

Then verify the final release commit:

```sh
npm ci
npm run check
npm audit
npm audit signatures
npx playwright install --with-deps chromium
npm run test:browser
npm pack --dry-run --json --ignore-scripts
```

Require the GitHub matrix to pass for that commit too. Inspect the packed file
list and browser screenshots. The npm package must contain the CLI, runtime,
viewer, skills, docs and licenses. Website sources, screenshots, test fixtures,
credentials and local project data must be absent.

## 2. Set up npm access

Create or use an npm account and enable two-factor authentication. Direct
publication requires 2FA or a granular token configured to bypass 2FA; interactive
2FA is the straightforward choice for the first manual release.

```sh
npm login
npm whoami
npm view mhproto name version dist-tags --json
```

E404 means no package was found; it does not guarantee the registry will accept
that name. If another owner claims it first, choose an owned scope and update
package metadata and install instructions before proceeding.

Source: [npm's public package publishing guide](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/).

## 3. Prepare a preview version

Suggested first release: `0.8.0-preview.0` on the `next` dist-tag. Confirm the version
before running these commands. Keep the source preview description until this
release is actually available.

```sh
npm version 0.8.0-preview.0 --no-git-tag-version
npm pkg delete private
npm pkg set publishConfig.access=public
npm run check
npm pack --pack-destination /tmp
```

These preparation commands do not publish to the registry. Record the generated
tarball's path and inspect its contents:

```sh
tar -tzf /tmp/mhproto-0.8.0-preview.0.tgz
```

Install that exact archive in a fresh temporary consumer:

```sh
consumer_dir=$(mktemp -d)
cd "$consumer_dir"
npm init -y
npm install --save-dev /tmp/mhproto-0.8.0-preview.0.tgz
node --input-type=module -e "import('mhproto').then(m => console.log(Object.keys(m)))"
npx mhproto --help
```

Repeat the documented scaffold, validation, skill installation, scoped context,
snapshot/diff and offline viewer export flow there. Verify the installed viewer
in Chromium, including save/reload without network access. Do not rely only on
running from the source checkout. Return to the library checkout, update the
release-review evidence, commit the version/metadata and require green CI.

## 4. Publish the reviewed archive

This is the first registry write. Run it only when the preceding gates pass and
the package owner has approved the exact version and archive.

```sh
npm publish /tmp/mhproto-0.8.0-preview.0.tgz --access public --tag next
npm view mhproto@0.8.0-preview.0 version dist.integrity dist-tags --json
```

Complete npm's 2FA prompt. `next` makes the preview available explicitly without
promoting it to the default `latest` channel. Verify installation in another clean
consumer with `npm install --save-dev mhproto@next`. Then tag the matching source
commit, create release notes, and update the private website's pinned library
commit and installation copy to `npm install -D mhproto@next` before deploying.

## 5. Configure later releases

After the first successful publication, configure npm trusted publishing for the
**public library repository**, `rbsx/mhproto`, with the exact GitHub release
workflow filename. Use a GitHub-hosted runner and `id-token: write`; keep
`package.json`'s repository URL aligned with that repository. Do not configure the
private website repository as the npm publisher.

Trusted publishing uses GitHub's OIDC identity instead of a stored npm token.
Supported public-repository releases can receive npm provenance automatically.
Keep release approval separate from ordinary pushes; use a manual or approved
release workflow. Add this workflow only after choosing the release process.

Source: [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

Promote a reviewed stable version to `latest` in a separate release once preview
feedback and the supported-platform checks justify it. Do not silently promote
the initial preview.

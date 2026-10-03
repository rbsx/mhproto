# Mermaid runtime

Mermaid 11.16.1, vendored from the official npm browser bundle as a single file so
both the local viewer and exported HTML render without a network dependency.

Upstream: https://github.com/mermaid-js/mermaid

API: https://mermaid.js.org/config/usage.html

## Verified identity — 2026-10-03

The copied bundle now has a verified relationship to the official
`mermaid@11.16.1` npm archive. Its executable body and embedded notices are
identical. The local transformation prepends Mermaid's MIT license, wraps the
bundle in an outer IIFE to keep its namespace private, and changes the last
assignment to expose that private namespace through `globalThis.mermaid`.
No source rebuild was performed. npm archive integrity establishes the relationship
to the pinned registry distribution; it is not an independent maintainer attestation.

`manifest.json` records archive integrity, upstream bundle/source-map hashes and
the resulting local hash. Repeat the full archive, license, wrapper and package
inventory comparison from the library checkout:

```sh
node scripts/verify-mermaid.mjs
```

The command downloads the exact npm archive without executing install scripts,
verifies its pinned SHA-512 integrity, and compares the complete vendored bytes.
It changes no repository files. With a previously downloaded archive:

```sh
node scripts/verify-mermaid.mjs /path/to/mermaid-11.16.1.tgz
```

The renderer uses strict security, no HTML labels, and a monochrome theme. Invalid
diagrams display an error and retain their source; they do not prevent reading
the endpoint.

## Remaining license review

`bundled-packages.json` identifies 59 exact dependency versions from the official
source map. It is a version inventory, not a completed license inventory.

For each listed version, obtain its npm archive without running scripts, inspect
its package license declaration and all relevant LICENSE/COPYING/NOTICE files,
and collect the required notices for the source that is actually bundled. Also
review inline third-party notices preserved in `mermaid.min.js`. Record the
package/version, license identifier, notice source, archive integrity and retained
license text. Preserve multiple versions as separate entries.

Do not generate this inventory from a fresh `npm install mermaid`: it can resolve
newer dependency versions than those compiled into this particular browser bundle.
Add the reviewed notices under `viewer/vendor/` and reference them from
`THIRD_PARTY_NOTICES.md`. Mark `licenseInventoryComplete` only once that review is
complete. The public npm release gate remains open until then.

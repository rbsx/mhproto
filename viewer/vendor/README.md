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
assignment to expose that private namespace through `globalThis.mermaid`. A full
license and notice appendix is added as a comment; executable upstream code is
unchanged.
No source rebuild was performed. npm archive integrity establishes the relationship
to the pinned registry distribution; it is not an independent maintainer attestation.

`manifest.json` records archive integrity, upstream bundle/source-map hashes and
the resulting local hash. Repeat the full archive, license, wrapper and package
inventory comparison from the library checkout:

```sh
node scripts/verify-mermaid.mjs
```

The command downloads the exact npm archive without executing install scripts,
verifies its pinned SHA-512 integrity, and compares the complete vendored bytes
including the notice appendix. It also checks the retained notice hashes.
It changes no repository files. With a previously downloaded archive:

```sh
node scripts/verify-mermaid.mjs /path/to/mermaid-11.16.1.tgz
```

The renderer uses strict security, no HTML labels, and a monochrome theme. Invalid
diagrams display an error and retain their source; they do not prevent reading
the endpoint.

## Completed license inventory — 2026-10-03

`license-inventory.json` records 74 package/version entries: the initial 59
versions from Mermaid's source map, Mermaid itself, its parser, 11 additional
versions from 32 matching parser chunks, and two dependencies exposed through
flattened webpack source maps. Every archive was fetched at its exact version,
verified against its recorded registry integrity, and its original license text
retained. Parser chunks match the published parser archive byte-for-byte;
vscode-uri source texts and path-browserify match their original archives.

All retained texts are combined in `NOTICE.txt` and appended to the browser bundle
for standalone export distribution. `licenses/` retains the individual original
texts, plus supplemental Node.js and embedded MIT attributions. Individual original notice line
endings are preserved; the combined appendix uses LF line endings. DOMPurify's offered Apache-2.0 alternative is selected;
its complete original dual-license text remains included. Khroma's MIT identifier
comes from its complete license text rather than an absent metadata field.

Repeat the full archive/notice comparison and nested-source coverage check:

```sh
node scripts/verify-mermaid-licenses.mjs
```

It downloads the 74 pinned archives without executing their scripts. It verifies
archive integrity, original license texts, parser source identities and package
coverage, changing no repository files. An optional argument points to a local
archive cache using the recorded package/version directory names.

## Separate security release gate

A live registry advisory check of these exact versions found matches for
DOMPurify 3.4.0, js-yaml 4.1.1 and lodash-es 4.17.23. The raw advisory response is
retained in `bundled-audit.json`; the completed license inventory does not imply
these versions are free of known vulnerabilities. Evaluate the actual call paths
and update or rebuild the renderer before clearing this npm release gate.

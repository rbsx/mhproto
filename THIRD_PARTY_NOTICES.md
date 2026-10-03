# Third-party software

MHProto's own source is MIT-licensed; see LICENSE.

## Offline Mermaid viewer

The viewer includes Mermaid 11.16.1 and its compiled dependencies. Their complete
retained license and notice texts are in `viewer/vendor/NOTICE.txt`, with separate
original texts in `viewer/vendor/licenses/`. The same notice appendix is embedded
in the browser bundle, so standalone HTML exports retain these notices.

`viewer/vendor/license-inventory.json` records 74 package/version entries, their
license declarations, retained notice sources, archive integrity and notice hashes.
The inventory follows both Mermaid's source map and the parser's nested source
maps, including flattened vscode-uri/path-browserify sources and the original
Node.js path module attribution. Embedded upstream attributions are preserved in
`viewer/vendor/embedded-notices.txt` and the bundle itself.

The recorded licenses are MIT, ISC, BSD-3-Clause and Apache-2.0. DOMPurify offers
MPL-2.0 OR Apache-2.0; this distribution selects its Apache-2.0 alternative while
retaining the full original dual-license notice. Khroma's MIT license is identified
from its license file because its package metadata omits the license field.

Mermaid's executable body is verified against the official npm archive. MHProto
adds a private namespace wrapper and the notice appendix; it does not modify the
bundled dependency code. No independent upstream source rebuild was performed.
See `viewer/vendor/README.md` for repeatable verification commands.

The completed notice review does not clear the separate dependency-security gate:
`viewer/vendor/bundled-audit.json` records current advisories matching bundled
DOMPurify, js-yaml and Lodash versions. npm publication remains disabled pending
that work; see doc/release-review.md.

## Separately installed dependencies

Runtime npm dependencies (Ajv, ajv-formats and YAML) are installed separately by
npm, with their own licenses. Development dependencies are not bundled into the
published runtime package.

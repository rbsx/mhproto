# Third-party software

MHProto's own source is MIT-licensed; see LICENSE. Third-party components retain
their respective licenses.

## Offline Mermaid viewer

The viewer includes a source rebuild of Mermaid 12.1.0 with patched, locked
browser dependencies. Complete retained notices are in `viewer/vendor/NOTICE.txt`,
with original texts in `viewer/vendor/licenses/`. The appendix is embedded in the
renderer, so standalone HTML exports retain it.

`viewer/vendor/license-inventory.json` records 79 package/version entries with
archive integrity, notice sources and hashes. Coverage follows esbuild inputs and
32 compiled parser chunks, including flattened vscode-uri/path-browserify sources.
Embedded upstream and original Node.js path module attributions are retained.

Licenses include MIT, ISC, BSD-3-Clause, Apache-2.0, EPL-2.0 and Unlicense.
DOMPurify offers MPL-2.0 OR Apache-2.0; this distribution selects Apache-2.0 while
retaining its complete original dual-license notice. Khroma's MIT terms come from
its license file; Fastdom's MIT terms come from its README.

ELK/elkjs is distributed under EPL-2.0. Copyright (c) 2017 Kiel University and
others. No changes were made to the supplied elkjs implementation; it is bundled
and minified by esbuild. JavaScript wrapper/build source for elkjs 0.9.3 is available
at https://github.com/kieler/elkjs/tree/a8304cf79fde75bc2ab1a89d28320f53f8637436;
ELK's Java algorithm source and tagged releases are at https://github.com/eclipse/elk.
The original EPL-2.0 text and source availability notice travel with the bundle.

Mermaid's runtime source and official build plugins are unchanged. MHProto uses
its own committed dependency lock, adds a namespace wrapper and appends notices.
Repeat the clean source rebuild and original-archive checks with
`npm run verify:vendor`; repeat the separate bundled security audit with
`npm run audit:vendor`. See `viewer/vendor/README.md`.

## Separately installed dependencies

Runtime npm dependencies (Ajv, ajv-formats and YAML) are installed separately by npm
with their own licenses. Development and renderer build dependencies are excluded
from the published runtime package.

# Third-party software

MHProto's own source is MIT-licensed; see LICENSE.

The offline viewer includes a separately licensed Mermaid browser bundle.
Mermaid's MIT text is in viewer/vendor/LICENSE. Embedded dependency copyright
and license notices are preserved inside viewer/vendor/mermaid.min.js.

The current bundle is verified byte-for-byte against the official
`mermaid@11.16.1` npm browser bundle with a recorded deterministic wrapper;
see viewer/vendor/README.md and viewer/vendor/manifest.json. Its official source
map identifies 59 bundled dependency versions in viewer/vendor/bundled-packages.json.
The complete license inventory and required notices still need review before an
npm release; see doc/release-review.md. No independent source rebuild was performed.

Runtime npm dependencies (Ajv, ajv-formats and YAML) are installed separately by
npm, with their own licenses. Development dependencies are not bundled into the
published runtime package.

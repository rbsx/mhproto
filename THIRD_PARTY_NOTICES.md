# Third-party software

MHProto's own source is MIT-licensed; see LICENSE.

The offline viewer includes a separately licensed Mermaid browser bundle.
Mermaid's MIT text is in viewer/vendor/LICENSE. Embedded dependency copyright
and license notices are preserved inside viewer/vendor/mermaid.min.js.

The current bundle was reused from a local distribution. Its upstream identity,
reproducible build and complete transitive license inventory still need to be
verified before a public release; see doc/release-review.md. It is not presented
as a verified official upstream artifact.

Runtime npm dependencies (Ajv, ajv-formats and YAML) are installed separately by
npm, with their own licenses. Development dependencies are not bundled into the
published runtime package.

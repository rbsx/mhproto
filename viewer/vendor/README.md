# Mermaid runtime

Mermaid 11.16.1, vendored as a browser IIFE so both the local viewer and exported HTML render without a network dependency. The runtime was reused from an installed local distribution; bundled third-party license notices remain in the file. Its final export refers to the bundle's lexical namespace, and an outer IIFE keeps that namespace private. The exported API is `globalThis.mermaid`.

Upstream: https://github.com/mermaid-js/mermaid
API: https://mermaid.js.org/config/usage.html

The renderer uses strict security, no HTML labels, and a monochrome theme. Invalid diagrams display an error and retain their source; they do not prevent reading the endpoint.

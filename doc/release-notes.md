# Unreleased

- **Building blocks.** A small core plus plugins, configured with `presets` and `plugins` in
  `mhproto.yaml` like Babel. OpenAPI is the built-in plugin and loads by default; existing
  projects need no changes. Plugins add interface adapters, entity kinds, checks, agent context,
  skills and viewer renderers through one API (`mhproto/plugin`). See doc/plugins.md.
- **Any source as entities.** Capabilities can list several `interfaces`. Validation, context
  (`--entity KIND:ID`), comparison and the viewer work on entities, with links between them
  (`x-mhproto-links` in OpenAPI).
- **Optional parts.** A capability needs only `id` and `spec`; `init --minimal` starts from rules.
- **Skills à la carte.** `skills --only`, `--remove` and `--check`; installs never overwrite. The
  format reference is the shared `mhproto-format` skill.
- `mhproto plugins` lists what a project loads.
- Snapshots are version 2 (entity-based). Version 1 snapshots and earlier exported previews still
  load as baselines.

# MHProto 0.8.0-preview.0

Published 2026-10-03 as a development preview on the npm `next` channel.

MHProto keeps behaviour, API contracts, examples and verification checks in your
repository, with a shared browser view for humans and scoped context for agents.

- Browse feature pages, endpoints and linked types; attach design references.
- Compare iterations and keep evidence linked to contract rules and examples.
- Scaffold a project and install five skills for Codex, Claude or both.
- Retrieve scoped context and run structured checks with stale-evidence detection.
- Export a portable browser preview with diagrams, attachments and notices.
- Render diagrams with source-built Mermaid 12.1.0 and patched dependencies.

Node 22/24 on Linux/macOS are tested targets. Windows and non-Chromium browser
flows remain unverified. This preview supports a documented OpenAPI 3.1/JSON Schema
subset, and check results are evidence rather than a proof of correctness.

Project overview and demo: https://mhproto.dev/
Documentation: https://mhproto.dev/docs/
Source: https://github.com/rbsx/mhproto

Install explicitly with `npm install -D mhproto@next`.

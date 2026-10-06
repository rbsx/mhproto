# Plugins

MHProto is a small core with plugins around it. The core owns what every contract has, whatever
it describes: numbered rules, examples, checks and their evidence, visuals, snapshots and
changes, and the context budget for agents. Plugins add **interfaces**: the sources that say what
the app exposes or stores, such as an OpenAPI file, SQL migrations, a GraphQL schema or a list of
screens. OpenAPI support is itself a built-in plugin, written against the same API described here.

You assemble a project the way you configure Babel: pick a preset, add plugins, done.

## Choose your parts

With no `presets` or `plugins` keys, the `recommended` preset loads OpenAPI. Existing
`mhproto.yaml` files keep working unchanged.

```yaml
version: 1
name: Shop
capabilities:
  - id: orders
    spec: mhproto/capabilities/orders/spec.md # the only required part
    interface: mhproto/interfaces/openapi.yaml # optional
    examples: mhproto/capabilities/orders/examples.yaml # optional
    checks: mhproto/capabilities/orders/checks.yaml # optional
```

A capability needs only `id` and `spec`. Start with rules alone (`mhproto init --minimal`) and
add an interface, examples and checks when you need them. Missing parts produce no empty files,
sections or warnings, except that rules without checks stay visible as gaps.

Add another source with `interfaces`. `interface: file` is shorthand for one OpenAPI entry:

```yaml
plugins:
  - sql # npm package mhproto-plugin-sql
  - ./tools/mhproto-flows.mjs # a module in this repository
  - [mhproto-plugin-graphql, { strict: true }] # with options
capabilities:
  - id: orders
    spec: mhproto/capabilities/orders/spec.md
    interfaces:
      - { adapter: openapi, file: mhproto/interfaces/openapi.yaml }
      - { adapter: sql, file: db/migrations }
      - { adapter: flows, file: mhproto/flows/orders.yaml, options: { start: cart } }
```

`mhproto plugins` lists what is loaded: each plugin's source, adapters, entity kinds, skills and
viewer script. `mhproto skills --only sql` installs a plugin's agent skill next to the built-in
ones.

### How names resolve

| Entry                        | Loads                                                               |
| ---------------------------- | ------------------------------------------------------------------- |
| `openapi`, `recommended`     | Built-in plugin or preset                                           |
| `./tools/x.mjs`              | A module in the project. It cannot point outside the project.       |
| `sql`                        | `mhproto-plugin-sql`, then `sql`, from the project's `node_modules` |
| `@team/sql`                  | `@team/mhproto-plugin-sql`, then `@team/sql`                        |
| `@team`                      | `@team/mhproto-plugin`                                              |
| `module:sql`                 | Exactly `sql`                                                       |
| `[name, { … }]`              | The same, with options passed to the plugin                         |
| Presets (`presets:` entries) | The same rules with `mhproto-preset-` as the prefix                 |

Plugins listed in `plugins` load first, then presets in order. When a preset includes a plugin the
project already lists, the project's entry and options win. Listing the same plugin twice in
`plugins` is an error. `presets: []` loads nothing by default, for projects without OpenAPI.

### Trust

Plugins are code. They run with your permissions when MHProto loads the project, like the
commands in `checks.yaml` do when you run `verify`. Use plugins you would add as a dev
dependency. The built-in plugins make no network or AI calls.

## Concepts

- **Entity**: one thing an interface describes, such as an operation, a type, a table, an event
  or a screen. Every entity has a `kind`, an `id`, the rule IDs it is bound by, and optional links
  to other entities. Its `data` is the plugin's own detail.
- **Kind**: a category of entity, declared by a plugin with a label (`table` → `Table`).
- **Interface adapter**: reads one kind of source and returns entities. A capability lists each
  adapter at most once.

The core works on entities, so a new kind gets these without plugin code:

- `mhproto check` reports missing or duplicate IDs, rule IDs that do not exist, links to missing
  entities, and entities with no rules (a warning; set `linkRequired: false` for supporting kinds
  such as types).
- `mhproto context --entity table:orders` returns the entity, its exact rules, links in both
  directions, examples, checks with evidence status and visuals, within the same budget.
- Snapshots and **Changes** compare entities field by field.
- The viewer lists entities on the feature page and gives each one a page with its rules, links,
  examples, checks and visuals. Search finds them, and visuals can target them.

Links connect sources. An entity's `links` use `kind:id`, or `capability/kind:id` across
capabilities. OpenAPI operations declare theirs with `x-mhproto-links: [table:orders]`.

## Write a plugin

A plugin is a module whose default export is a plugin object, or a function that receives the
plugin API and the options from `mhproto.yaml` and returns one. This one reads screens from YAML:

```js
// tools/mhproto-flows.mjs
import { definePlugin } from 'mhproto/plugin';

export default definePlugin((api, options) => {
  api.assertVersion(1);
  return {
    name: 'flows',
    kinds: { screen: { label: 'Screen', plural: 'Screens' } },
    interfaces: {
      flows: {
        async load({ file, readYaml }) {
          const doc = await readYaml(file);
          return {
            document: doc,
            entities: doc.screens.map((screen) => ({
              kind: 'screen',
              id: screen.id,
              title: screen.title,
              rules: screen.rules ?? [],
              links: (screen.next ?? []).map((id) => `screen:${id}`),
              data: { states: screen.states ?? [] },
            })),
          };
        },
        validate({ document }, { error }) {
          if (!document.screens.some((s) => s.id === options.start))
            error(`Start screen ${options.start} is not defined`);
        },
      },
    },
  };
});
```

That is a complete plugin: `check`, `context`, `diff`, `snapshot`, `view` and `build` all handle
screens now. Add the hooks below only when the defaults are not enough.

`definePlugin` returns its argument unchanged; it gives editors the types in
[`src/plugin.mjs`](../src/plugin.mjs). Import it from `mhproto/plugin`, the only module plugins
should depend on.

## Reference

### Plugin object

| Field        | Type                                          | Purpose                                                                   |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------- |
| `name`       | string                                        | Lowercase name shown by `mhproto plugins` and in errors.                  |
| `kinds`      | `{ kind: { label, plural?, linkRequired? } }` | Entity kinds this plugin introduces. Two plugins cannot declare one kind. |
| `interfaces` | `{ adapter: InterfaceAdapter }`               | Adapters by the name used in `interfaces:` entries.                       |
| `validate`   | `(project, { error, warning })`               | Project-wide checks. `error(message, capabilityId?)`.                     |
| `skills`     | `[{ name, path }]`                            | Skill directories that `mhproto skills` installs.                         |
| `viewer`     | path or file URL                              | A browser script with page renderers for this plugin's kinds.             |

Unknown fields and hooks are errors, so a typo fails at load time instead of being ignored.
Relative paths resolve from the plugin's own directory; `new URL('./x', import.meta.url)` is the
clearest form. The kinds `feature`, `rule`, `example`, `check`, `visual`, `system`, `request`,
`response` and `field` are reserved.

The factory receives `api`: `version` (the plugin API version, currently 1), `mhproto` (package
version), `root` and `assertVersion(n)`.

### Interface adapter

| Hook                                | When                               | Returns                                                       |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `load(context)` (required)          | Every project load                 | `{ entities, document?, meta? }`                              |
| `validate(loaded, context)`         | `check`, `verify`, `view`, `build` | Nothing; report with `context.error/warning/cite`             |
| `validateExample(example, context)` | For each example in the capability | Nothing; check payloads against the source                    |
| `packet(entity, context)`           | `mhproto context --entity kind:id` | The packet body                                               |
| `visualTarget(target, context)`     | Validating a visual's target       | Error string, `null` if valid, `undefined` to use the default |

`load` receives `{ root, file, options, capability, readText, readYaml, list }`. Use the readers:
they keep paths inside the project. `file` can be a directory, and its whole contents count
towards evidence freshness. Keep `load` deterministic and offline. Read the app's own source of
truth; do not ask teams to keep a copy for MHProto.

`entities` and `meta` must be plain JSON, because they appear in the project model, snapshots and
exports. `meta` is for interface-wide settings worth reviewing, such as a dialect; changes to it
show on the feature in **Changes**. `document` stays in memory for your other hooks and is not
serialised.

`validate` and `validateExample` receive `{ project, capability, interface, entities, error,
warning, cite }`. `cite(ruleId, where)` reports `where references missing rule …` for an unknown
ID. Core already checks entity IDs, rule IDs and links.

`packet` receives helpers that keep packets consistent: `defaults(entity)` (the generic
sections), `select(sections)` (applies `--section`, hides `sources` unless asked, and lists valid
names on a typo), `rules(ids)`, `examples(entity)`, `checks(entity)`, `visuals(entity)`,
`evidence(check)` and `sources(entity)`. Return exact rule text and explicit references; never
summarise or truncate. The example SQL plugin puts columns first:

```js
packet(entity, context) {
  const { definition, ...sections } = context.defaults(entity);
  return { table: { id: entity.id, columns: definition.columns }, ...context.select(sections) };
}
```

### Viewer renderers

Without a renderer, an entity page shows `data` as a JSON definition. A plugin's `viewer` script
can render it instead. It is a plain script, loaded by `mhproto view` and inlined by
`mhproto build`, so exported previews keep working offline:

```js
(globalThis.mhprotoViewerPlugins ??= []).push({
  name: 'flows',
  kinds: {
    screen: {
      section: (screen, ui) =>
        ui.html`<section><h2>States</h2><ul>${screen.data.states.map((s) => ui.html`<li>${s}</li>`)}</ul></section>`,
      summary: (screen, ui) =>
        ui.html`<span class="section-note">${screen.data.states.length} states</span>`,
    },
  },
});
```

`section` replaces the definition on the entity page; `summary` is the line under each entity on
the feature page. `ui.html` escapes every interpolated value unless it came from `ui.html` or
`ui.raw`, so contract text cannot become markup. `ui.json(value)` and
`ui.disclosure(title, body, open)` match the viewer's own blocks, and `ui.escape` is available
for plain strings. If a renderer throws, the page shows the error and falls back to the
definition.

## Test and publish

Load a fixture project with the public API and assert on what users see:

```js
import { loadProject, validateProject } from 'mhproto';

const project = await loadProject('test/fixture');
assert.deepEqual(await validateProject(project), []);
assert.equal(project.capabilities[0].entities[0].kind, 'screen');
```

For packets, run the CLI against the fixture: `mhproto context --entity screen:home --root test/fixture`.

The [example SQL plugin](https://github.com/rbsx/mhproto/tree/main/examples/plugin-sql) uses every
extension point, and `test/plugins.test.mjs` exercises it end to end.

To share a plugin, publish it as `mhproto-plugin-<name>` (or `@scope/mhproto-plugin-<name>`)
with `mhproto` as a peer dependency, export the plugin as the package's default export, and call
`api.assertVersion(1)`. Users then add `<name>` to `plugins`.

## Compatibility

- `interface:` keeps meaning one OpenAPI file; `mhproto.yaml` files without `presets` or
  `plugins` load exactly as before. Evidence digests are unchanged, so recorded runs stay fresh.
- The OpenAPI plugin reproduces the previous output: on the demo project, every context packet,
  every comparison and all 322 viewer pages are identical.
- Snapshots are now version 2 and store interfaces and entities. Version 1 snapshots and exported
  previews from earlier releases still load as baselines.
- Capabilities with OpenAPI keep the `openapi`, `operations`, `transitions` and `nonTransitions`
  fields in `mhproto inspect`; OpenAPI entities are derived from them. They will move to entities
  when the viewer's OpenAPI pages become a renderer like any other plugin's.
- Each adapter appears at most once per capability in this version.

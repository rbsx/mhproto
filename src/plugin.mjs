// Public plugin API: `import { definePlugin } from 'mhproto/plugin'`.
// The built-in OpenAPI support (src/plugins/openapi) uses only what is described here.
export { shapeAsserter } from './config.mjs';

/** The plugin API version this MHProto provides. Plugins can require it with `api.assertVersion`. */
export const apiVersion = 1;

/**
 * Something an interface describes: an operation, a type, a table, an event, a screen.
 * Entities are plain JSON. They appear in the project model, snapshots and context packets.
 *
 * @typedef {object} Entity
 * @property {string} kind      A kind declared by a plugin, such as `table`.
 * @property {string} id        Stable within its capability and kind.
 * @property {string} [title]   Short label for pages and changes, such as `POST /orders`.
 * @property {string} [summary] One sentence for lists.
 * @property {string[]} [rules] Rule IDs this entity is bound by. `mhproto check` reports unknown IDs.
 * @property {Array<string | EntityLinkTarget>} [links]
 *   Other entities this one depends on, as `kind:id`, `capability/kind:id` or objects.
 * @property {unknown} [data]   The adapter's own detail. Shown as the definition and compared field by field.
 */

/**
 * @typedef {object} EntityLinkTarget
 * @property {string} kind
 * @property {string} id
 * @property {string} [capability] Defaults to the entity's own capability.
 * @property {string} [relation]   Free text such as `reads` or `writes`.
 */

/**
 * @typedef {object} EntityKind
 * @property {string} label           Singular, such as `Table`.
 * @property {string} [plural]        Section heading, such as `Tables`.
 * @property {boolean} [linkRequired] Warn when an entity of this kind has no rules. Default true.
 */

/**
 * @typedef {object} LoadContext
 * @property {string} root     Absolute project root.
 * @property {string} file     The interface path from mhproto.yaml, relative to the root.
 * @property {object} options  `options` from the capability's interface entry.
 * @property {{id: string}} capability The capability configuration (read-only).
 * @property {(relative: string) => Promise<string>} readText  Read a project file. Paths cannot escape the project.
 * @property {(relative: string) => Promise<unknown>} readYaml Read and parse YAML or JSON.
 * @property {(relative: string) => Promise<string[]>} list    Sorted names in a project directory.
 */

/**
 * @typedef {object} Loaded
 * @property {unknown} [document]  The parsed source, kept for the adapter's own hooks.
 * @property {Entity[]} entities
 * @property {unknown} [meta]      Interface-wide settings worth comparing, such as a database dialect.
 */

/**
 * @typedef {object} ValidateContext
 * @property {object} project     The loaded project model.
 * @property {object} capability  The capability model, with rules, examples and checks.
 * @property {{adapter: string, file: string, document?: unknown, meta?: unknown}} interface
 * @property {Entity[]} entities  This interface's entities.
 * @property {(message: string) => void} error
 * @property {(message: string) => void} warning
 * @property {(ruleId: string, where: string) => void} cite Report `where references missing rule` when the rule is unknown.
 */

/**
 * @typedef {object} PacketContext
 * @property {object} project
 * @property {object} capability
 * @property {{adapter: string, file: string, document?: unknown}} interface
 * @property {(ids: string[]) => object[]} rules    Exact rule objects for the given IDs.
 * @property {(entity: Entity) => object[]} examples Example summaries linked to the entity.
 * @property {(entity: Entity) => object[]} checks   Linked checks with their evidence status.
 * @property {(entity: Entity) => object[]} visuals  Visual metadata targeting the entity.
 * @property {(entity: Entity) => object} sources    Contract and implementation files.
 * @property {(entity: Entity) => Record<string, unknown>} defaults
 *   The generic sections (definition, links, behaviour, examples, checks, visuals, sources).
 */

/**
 * Reads one kind of source and normalises it into entities.
 *
 * @typedef {object} InterfaceAdapter
 * @property {(context: LoadContext) => Loaded | Promise<Loaded>} load
 * @property {(loaded: Loaded, context: ValidateContext) => void | Promise<void>} [validate]
 *   Source-specific checks. Core already checks entity IDs, rule IDs and links.
 * @property {(example: object, context: ValidateContext) => void} [validateExample]
 *   Check an example's payloads against the source, when the adapter can.
 * @property {(entity: Entity, context: PacketContext) => Record<string, unknown>} [packet]
 *   Sections for `mhproto context --entity kind:id`. Defaults to `context.defaults(entity)`.
 * @property {(target: object, context: {capability: object, project: object}) => string | null | undefined} [visualTarget]
 *   Validate a visual target of one of this adapter's kinds. Return an error, null when valid,
 *   or undefined to fall back to "the entity exists".
 */

/**
 * @typedef {object} Plugin
 * @property {string} name
 * @property {Record<string, EntityKind>} [kinds]            Entity kinds this plugin introduces.
 * @property {Record<string, InterfaceAdapter>} [interfaces] Adapters by the name used in mhproto.yaml.
 * @property {(project: object, report: {error: Function, warning: Function}) => void | Promise<void>} [validate]
 *   Project-wide checks, such as links across capabilities or team conventions.
 * @property {Array<{name: string, path: string | URL}>} [skills]
 *   Agent skill directories that `mhproto skills` installs next to the built-in ones.
 * @property {string | URL} [viewer]
 *   A browser script that registers page sections for this plugin's kinds (see doc/plugins.md).
 */

/**
 * @typedef {object} PluginApi
 * @property {number} version   The plugin API version.
 * @property {string} mhproto   The MHProto package version.
 * @property {string} root      Absolute project root.
 * @property {(required: number) => void} assertVersion Throw unless this MHProto provides `required`.
 */

/**
 * @typedef {object} Preset
 * @property {Array<string | [string, object]>} [plugins]
 * @property {Array<string | [string, object]>} [presets]
 */

/**
 * Declare a plugin. Accepts the plugin object or a factory `(api, options) => plugin`.
 * Returns its argument unchanged; it exists for editor types and readability.
 *
 * @template {Plugin | ((api: PluginApi, options: object) => Plugin | Promise<Plugin>)} T
 * @param {T} plugin
 * @returns {T}
 */
export function definePlugin(plugin) {
  return plugin;
}

/**
 * Declare a preset: a named list of plugins and presets.
 *
 * @template {Preset | ((api: PluginApi, options: object) => Preset | Promise<Preset>)} T
 * @param {T} preset
 * @returns {T}
 */
export function definePreset(preset) {
  return preset;
}

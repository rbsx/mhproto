// Resolves `presets` and `plugins` from mhproto.yaml into one registry of
// entity kinds, interface adapters, validators, skills and viewer scripts.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectPath } from './paths.mjs';
import { apiVersion } from './plugin.mjs';
import openapi from './plugins/openapi/index.mjs';
import recommended from './presets/recommended.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
const { version: packageVersion } = JSON.parse(
  await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
);
const builtins = { plugin: { openapi }, preset: { recommended } };
export const defaultPresets = ['recommended'];
// Kinds that already name contract parts or visual targets.
const reservedKinds = new Set([
  'feature',
  'rule',
  'example',
  'check',
  'visual',
  'system',
  'request',
  'response',
  'field',
]);
const slug = /^[a-z][a-z0-9-]*$/;
const pluginFields = new Set(['name', 'kinds', 'interfaces', 'validate', 'skills', 'viewer']);
const adapterHooks = new Set(['load', 'validate', 'validateExample', 'packet', 'visualTarget']);

function entry(value) {
  const [name, options = {}] = Array.isArray(value) ? value : [value];
  return { name, options };
}

// Babel-style names: `sql` → `mhproto-plugin-sql`, `@team/sql` → `@team/mhproto-plugin-sql`,
// `@team` → `@team/mhproto-plugin`. `module:name` skips the prefix.
export function packageCandidates(name, type) {
  const prefix = `mhproto-${type}`;
  if (name.startsWith('module:')) return [name.slice('module:'.length)];
  const scoped = /^(@[^/]+)(?:\/(.+))?$/.exec(name);
  if (scoped)
    return !scoped[2]
      ? [`${scoped[1]}/${prefix}`]
      : scoped[2].startsWith(prefix)
        ? [name]
        : [`${scoped[1]}/${prefix}-${scoped[2]}`, name];
  return name.startsWith(prefix) ? [name] : [`${prefix}-${name}`, name];
}

function exportsEntry(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, '.')) return exportsEntry(value['.']);
  if (Object.keys(value).some((key) => key.startsWith('.'))) return undefined;
  return exportsEntry(value.import ?? value.node ?? value.default);
}

async function resolvePackage(root, name) {
  const require = createRequire(path.join(root, 'package.json'));
  try {
    return require.resolve(name);
  } catch (error) {
    if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
  }
  // ESM-only packages may export no `require` condition.
  for (const directory of require.resolve.paths(name) ?? []) {
    const base = path.join(directory, name);
    try {
      const manifest = JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8'));
      return path.join(base, exportsEntry(manifest.exports) ?? manifest.main ?? 'index.js');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function resolveModule(root, name, type) {
  if (typeof name !== 'string' || !name) throw new Error(`Invalid ${type} name: ${name}`);
  if (Object.hasOwn(builtins[type], name))
    return { id: `builtin:${name}`, source: 'built-in', value: builtins[type][name] };
  if (path.isAbsolute(name))
    throw new Error(`Use a project-relative path for ${type} ${name}, such as ./tools/${type}.mjs`);
  let file;
  if (name.startsWith('./') || name.startsWith('../')) {
    file = await projectPath(root, name).catch((error) => {
      throw new Error(
        `Cannot load ${type} ${name}: ${error.code === 'ENOENT' ? 'file not found' : error.message}`,
      );
    });
    if ((await stat(file)).isDirectory())
      throw new Error(`Point ${type} ${name} at a module file, not a directory`);
  } else {
    const candidates = packageCandidates(name, type);
    for (const candidate of candidates) {
      file = await resolvePackage(root, candidate);
      if (file) break;
    }
    if (!file)
      throw new Error(
        `Cannot find ${type} "${name}". Install ${candidates.join(' or ')} in the project, or use a relative path.`,
      );
  }
  const module = await import(pathToFileURL(file).href);
  if (module.default === undefined) throw new Error(`${type} ${name} has no default export`);
  return { id: file, source: path.relative(root, file) || file, file, value: module.default };
}

function localFile(value, base, where) {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value !== 'string' || !value) throw new Error(`${where} must be a path or file URL`);
  if (value.startsWith('file:')) return fileURLToPath(value);
  return path.resolve(base, value);
}

function checkPlugin(plugin, where, base) {
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin))
    throw new Error(`${where}: export a plugin object or a function that returns one`);
  if (typeof plugin.name !== 'string' || !/^[@a-z0-9][a-z0-9._/@-]*$/.test(plugin.name))
    throw new Error(`${where}: a plugin needs a lowercase name`);
  where = `Plugin ${plugin.name}`;
  for (const key of Object.keys(plugin))
    if (!pluginFields.has(key))
      throw new Error(
        `${where}: unknown field "${key}" (expected ${[...pluginFields].join(', ')})`,
      );
  const kinds = {};
  for (const [kind, value] of Object.entries(plugin.kinds ?? {})) {
    if (!slug.test(kind) || reservedKinds.has(kind))
      throw new Error(`${where}: "${kind}" cannot be used as an entity kind`);
    if (typeof value?.label !== 'string' || !value.label)
      throw new Error(`${where}: kind ${kind} needs a label`);
    kinds[kind] = {
      label: value.label,
      plural: typeof value.plural === 'string' ? value.plural : value.label + 's',
      linkRequired: value.linkRequired !== false,
    };
  }
  const interfaces = {};
  for (const [name, adapter] of Object.entries(plugin.interfaces ?? {})) {
    if (!slug.test(name)) throw new Error(`${where}: invalid interface adapter name "${name}"`);
    if (typeof adapter?.load !== 'function')
      throw new Error(`${where}: interface adapter ${name} needs a load() function`);
    for (const [hook, value] of Object.entries(adapter)) {
      if (!adapterHooks.has(hook))
        throw new Error(
          `${where}: adapter ${name} has unknown hook "${hook}" (expected ${[...adapterHooks].join(', ')})`,
        );
      if (typeof value !== 'function')
        throw new Error(`${where}: ${name}.${hook} must be a function`);
    }
    interfaces[name] = adapter;
  }
  if (plugin.validate !== undefined && typeof plugin.validate !== 'function')
    throw new Error(`${where}: validate must be a function`);
  if (plugin.skills !== undefined && !Array.isArray(plugin.skills))
    throw new Error(`${where}: skills must be an array`);
  const skills = (plugin.skills ?? []).map((skill) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skill?.name ?? ''))
      throw new Error(`${where}: each skill needs a lowercase name`);
    return { name: skill.name, path: localFile(skill.path, base, `${where} skill ${skill.name}`) };
  });
  return {
    name: plugin.name,
    kinds,
    interfaces,
    validate: plugin.validate,
    skills,
    viewer: plugin.viewer === undefined ? null : localFile(plugin.viewer, base, `${where} viewer`),
  };
}

export async function loadPlugins(root, config = {}) {
  const api = Object.freeze({
    version: apiVersion,
    mhproto: packageVersion,
    root,
    assertVersion(required) {
      if (required !== apiVersion)
        throw new Error(
          `This plugin needs MHProto plugin API ${required}; MHProto ${packageVersion} provides ${apiVersion}`,
        );
    },
  });
  const loaded = [],
    seen = new Set();
  const instantiate = async (value, type, where) => {
    const { name, options } = entry(value);
    const resolved = await resolveModule(root, name, type);
    let result = resolved.value;
    try {
      if (typeof result === 'function') result = await result(api, options);
    } catch (error) {
      throw new Error(`${where} ${name}: ${error.message}`);
    }
    return { name, options, resolved, result };
  };
  const addPlugin = async (value, where, explicit) => {
    const { name, resolved, result } = await instantiate(value, 'plugin', where);
    if (seen.has(resolved.id)) {
      // A plugin the project lists itself wins over the same plugin from a preset.
      if (explicit) throw new Error(`Plugin ${name} is listed twice in mhproto.yaml`);
      return;
    }
    seen.add(resolved.id);
    const base = resolved.file ? path.dirname(resolved.file) : packageRoot;
    loaded.push({ ...checkPlugin(result, `Plugin ${name}`, base), source: resolved.source });
  };
  const addPreset = async (value, chain) => {
    const { name, result } = await instantiate(value, 'preset', 'Preset');
    if (chain.includes(name)) throw new Error(`Preset cycle: ${[...chain, name].join(' → ')}`);
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error(`Preset ${name}: export { plugins, presets } or a function returning it`);
    for (const key of Object.keys(result))
      if (!['plugins', 'presets'].includes(key))
        throw new Error(`Preset ${name}: unknown field "${key}"`);
    for (const plugin of result.plugins ?? []) await addPlugin(plugin, `Preset ${name}`, false);
    for (const preset of result.presets ?? []) await addPreset(preset, [...chain, name]);
  };
  for (const plugin of config.plugins ?? []) await addPlugin(plugin, 'Plugin', true);
  for (const preset of config.presets ?? defaultPresets) await addPreset(preset, []);
  return registryOf(loaded);
}

function registryOf(plugins) {
  const registry = {
    plugins,
    kinds: new Map(),
    adapters: new Map(),
    skills: [],
    viewers: [],
  };
  for (const plugin of plugins) {
    for (const [kind, value] of Object.entries(plugin.kinds)) {
      const other = registry.kinds.get(kind);
      if (other)
        throw new Error(
          `Entity kind "${kind}" is declared by both ${other.plugin} and ${plugin.name}`,
        );
      registry.kinds.set(kind, { ...value, plugin: plugin.name });
    }
    for (const [name, adapter] of Object.entries(plugin.interfaces)) {
      const other = registry.adapters.get(name);
      if (other)
        throw new Error(
          `Interface adapter "${name}" is provided by both ${other.plugin.name} and ${plugin.name}`,
        );
      registry.adapters.set(name, { name, adapter, plugin });
    }
    for (const skill of plugin.skills) {
      if (registry.skills.some((s) => s.name === skill.name))
        throw new Error(`Skill ${skill.name} is provided by more than one plugin`);
      registry.skills.push({ ...skill, plugin: plugin.name });
    }
    if (plugin.viewer)
      registry.viewers.push({
        plugin: plugin.name,
        url: `plugins/${registry.viewers.length}-${plugin.name.replace(/[^a-z0-9-]+/g, '-')}.js`,
        file: plugin.viewer,
      });
  }
  return registry;
}

// The registry used for models that were not loaded from disk, such as snapshots.
let fallback;
export function builtinRegistry() {
  return (fallback ??= registryOf([
    { ...checkPlugin(openapi(), 'Plugin openapi', packageRoot), source: 'built-in' },
  ]));
}

// JSON description of the registry, kept in the project model.
export function describeRegistry(registry) {
  return {
    plugins: registry.plugins.map((plugin) => ({
      name: plugin.name,
      source: plugin.source,
      kinds: Object.keys(plugin.kinds),
      interfaces: Object.keys(plugin.interfaces),
      skills: plugin.skills.map((skill) => skill.name),
      viewer: registry.viewers.find((v) => v.plugin === plugin.name)?.url ?? null,
    })),
    kinds: Object.fromEntries(
      [...registry.kinds].map(([kind, value]) => [
        kind,
        { label: value.label, plural: value.plural, plugin: value.plugin },
      ]),
    ),
  };
}

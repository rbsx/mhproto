import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { atomicWrite, writePath } from './paths.mjs';
import { builtinRegistry } from './plugins.mjs';
import { entitiesOf, interfacesOf } from '../viewer/diff.js';

export const visualsFile = 'mhproto/visuals.yaml';
const queues = new Map();
export const mediaTypes = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};
export const maxMediaBytes = 8 * 1024 * 1024;
export function mediaMime(file) {
  return Object.entries(mediaTypes).find(
    ([, ext]) =>
      path.extname(file).slice(1).toLowerCase() === ext ||
      (ext === 'jpg' && path.extname(file).toLowerCase() === '.jpeg'),
  )?.[0];
}
export function safeDesignUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function targetError(project, target) {
  if (!target || typeof target !== 'object') return 'Visual requires a target';
  const cap = project.capabilities.find((c) => c.id === target.capability);
  if (!cap) return 'Visual references an unknown feature';
  if (target.kind === 'feature') return null;
  const items = {
    example: cap.examples.map((e) => e.id),
    rule: cap.rules.map((r) => r.id),
    check: cap.checks.map((c) => c.id),
  };
  if (items[target.kind])
    return items[target.kind].includes(target.id)
      ? null
      : 'Visual references an unknown ' + target.kind;
  const registry = project.registry ?? builtinRegistry();
  for (const item of interfacesOf(cap)) {
    const error = registry.adapters
      .get(item.adapter)
      ?.adapter.visualTarget?.(target, { capability: cap, project });
    if (error !== undefined) return error;
  }
  if (!registry.kinds.has(target.kind)) return 'Unsupported visual target';
  return entitiesOf(cap).some((e) => e.kind === target.kind && e.id === target.id)
    ? null
    : 'Visual references an unknown ' + target.kind;
}
export function validMedia(bytes, mime) {
  if (mime === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp')
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6));
  return mime === 'application/pdf' && bytes.toString('ascii', 0, 5) === '%PDF-';
}
export async function addVisual(root, project, input) {
  const operation = async () => {
    if (!input || typeof input !== 'object') throw new Error('Visual input must be an object');
    if (Boolean(input.url) === Boolean(input.data))
      throw new Error('Choose exactly one file or design link');
    const error = targetError(project, input.target);
    if (error) throw new Error(error);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200)
      throw new Error('Visual requires a title (up to 200 characters)');
    const visual = {
      id: randomUUID(),
      title: input.title.trim(),
      kind: input.url ? 'design' : 'screenshot',
      target: input.target,
    };
    if (input.caption) {
      if (typeof input.caption !== 'string' || input.caption.length > 1000)
        throw new Error('Caption is too long');
      visual.caption = input.caption;
    }
    let bytes;
    if (input.url) {
      if (!safeDesignUrl(input.url)) throw new Error('Design links must use HTTPS');
      visual.url = input.url;
    } else {
      const match = /^data:([^;]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(input.data ?? '');
      if (!match || !mediaTypes[match[1]]) throw new Error('Use a PNG, JPEG, WebP, GIF or PDF');
      bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > maxMediaBytes)
        throw new Error('Visual files must be between 1 byte and 8 MB');
      if (!validMedia(bytes, match[1]))
        throw new Error('Visual content does not match its media type');
      visual.mime = match[1];
      if (visual.mime === 'application/pdf') visual.kind = 'design';
      visual.file = `mhproto/assets/${visual.id}.${mediaTypes[visual.mime]}`;
      visual.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    const metadata = await writePath(root, visualsFile);
    let entries = [];
    try {
      entries = parse(await readFile(metadata, 'utf8'))?.visuals;
      if (!Array.isArray(entries)) throw new Error('visuals.yaml requires a visuals array');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (bytes) await writeFile(await writePath(root, visual.file), bytes, { flag: 'wx' });
    await atomicWrite(root, visualsFile, stringify({ visuals: [...entries, visual] }));
    return visual;
  };
  const previous = queues.get(root) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  queues.set(root, task);
  try {
    return await task;
  } finally {
    if (queues.get(root) === task) queues.delete(root);
  }
}

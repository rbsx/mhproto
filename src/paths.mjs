import { mkdir, realpath, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const inside = (base, candidate) => candidate === base || candidate.startsWith(base + path.sep);

export async function projectPath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative))
    throw new Error(`Expected project-relative path: ${relative}`);
  const base = await realpath(root);
  const actual = await realpath(path.resolve(base, relative));
  if (!inside(base, actual)) throw new Error(`Path escapes project: ${relative}`);
  return actual;
}

export async function writePath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative))
    throw new Error(`Expected project-relative path: ${relative}`);
  const base = await realpath(root),
    candidate = path.resolve(base, relative);
  if (candidate === base || !inside(base, candidate))
    throw new Error(`Path escapes project: ${relative}`);
  let ancestor = candidate;
  while (true) {
    try {
      if (!inside(base, await realpath(ancestor)))
        throw new Error(`Path escapes project through symlink: ${relative}`);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  await mkdir(path.dirname(candidate), { recursive: true });
  return candidate;
}

export async function atomicWrite(root, relative, contents) {
  const destination = await writePath(root, relative);
  const temporary = path.join(
    path.dirname(destination),
    '.' + path.basename(destination) + '-' + randomUUID() + '.tmp',
  );
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return destination;
}

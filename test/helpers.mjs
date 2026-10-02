import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';

const directories = [];
export async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(prefix);
  directories.push(directory);
  return directory;
}
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

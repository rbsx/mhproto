import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { openapiEntities, openapiGlobals, openapiView } from '../viewer/diff.js';

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

// Edit a capability's OpenAPI document and operations, then store them back as
// entities and interface meta, as loading the edited files would.
export function editOpenapi(cap, change) {
  const view = openapiView(cap);
  change(view);
  const item = cap.interfaces.find((i) => i.adapter === 'openapi');
  item.meta = openapiGlobals(view.openapi);
  cap.entities = [
    ...openapiEntities({ operations: view.operations, document: view.openapi, file: item.file }),
    ...cap.entities.filter((e) => e.adapter !== 'openapi'),
  ];
  return cap;
}

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const vendor = new URL('../viewer/vendor/', import.meta.url);
const inventory = JSON.parse(await readFile(new URL('license-inventory.json', vendor)));
const packages = inventory.packages.map((p) => p.package + '@' + p.version).sort();
const payload = {};
for (const p of inventory.packages) (payload[p.package] ??= []).push(p.version);
const endpoint = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
assert.equal(response.status, 200, 'Registry audit response');
const advisories = await response.json();
const report = { checkedAt: new Date().toISOString(), endpoint, packages, advisories };
if (process.argv.includes('--write'))
  await writeFile(new URL('bundled-audit.json', vendor), JSON.stringify(report, null, 2) + '\n');
else console.log(JSON.stringify(report, null, 2));
assert.deepEqual(advisories, {}, 'Known advisory matches in vendored dependencies');
console.log(`No known advisory matches for ${packages.length} recorded renderer package versions.`);

import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const files = ['manifests/ids.json', 'templates/selo.template.json'];
for (const name of await readdir('src/data/selos')) if (name.endsWith('.json')) files.push('src/data/selos/' + name);
for (const id of await readdir('public/assets/selos')) {
  for (const name of await readdir(path.join('public/assets/selos', id))) {
    if (/\.(webp|png|jpe?g)$/.test(name)) files.push('public/assets/selos/' + id + '/' + name);
  }
}

const candidates = ['.netlify/v1/functions/ssr'];

for (const file of files) {
  const expected = createHash('sha256').update(await readFile(file)).digest('hex');
  let actual = null;

  for (const root of candidates) {
    const candidate = path.join(root, file);
    try {
      await access(candidate, constants.F_OK);
      actual = createHash('sha256').update(await readFile(candidate)).digest('hex');
      break;
    } catch {
      continue;
    }
  }

  assert.equal(actual, expected, 'Bundle ausente ou divergente: ' + file);
}

console.log('Bundle Netlify verificado: ' + files.length + ' arquivos de runtime e mídia, hashes idênticos às fontes.');

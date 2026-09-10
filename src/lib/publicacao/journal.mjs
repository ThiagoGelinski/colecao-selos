import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getStore } from '@netlify/blobs';
import { ROOT } from '../catalogo/paths.mjs';
import { isServerlessEngine } from '../catalogo/io.mjs';
import { jsonDigest } from '../catalogo/digest.mjs';
import { operationError } from '../admin/editor.mjs';
export function createPublicationJournal() {
  const cloud = isServerlessEngine();
  const store = cloud ? getStore({name:'colecao-selos-publicacao',consistency:'strong'}) : null;
  const directory = path.join(ROOT,'data','publicacao');
  const safe = key => {
    if (!/^(reviews|pulls)\/SEL-\d{6}\/[a-f0-9]{64}\.json$/.test(key)) throw new Error('Chave de publicação inválida.');
    return path.join(directory,...key.split('/'));
  };
  const get = async key => {
    const file = safe(key);
    if (cloud) return store.get(key,{type:'json',consistency:'strong'});
    try { return JSON.parse(await readFile(file,'utf8')); } catch(error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const put = async (key,value) => {
    const file = safe(key);
    if (cloud) {
      const result = await store.setJSON(key,value,{onlyIfNew:true});
      if (!result?.modified) return get(key);
    } else {
      await mkdir(path.dirname(file),{recursive:true});
      try { await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'}); }
      catch(error) { if (error.code === 'EEXIST') return get(key); throw error; }
    }
    const stored = await get(key);
    if (jsonDigest(stored) !== jsonDigest(value)) throw operationError('JOURNAL_ERROR','Não foi possível verificar o recibo de publicação.');
    return stored;
  };
  const latest = async id => {
    const prefix = `reviews/${id}/`;
    safe(`${prefix}${'0'.repeat(64)}.json`);
    let keys;
    if (cloud) {
      keys = [];
      for await (const page of store.list({prefix,paginate:true})) keys.push(...page.blobs.map(blob => blob.key));
    } else {
      try { keys = (await readdir(path.join(directory,'reviews',id))).map(name => prefix+name); }
      catch(error) { if (error.code === 'ENOENT') return null; throw error; }
    }
    const values = await Promise.all(keys.map(get));
    return values.filter(Boolean).sort((a,b) => b.approved_at.localeCompare(a.approved_at))[0] ?? null;
  };
  return {get,put,latest};
}
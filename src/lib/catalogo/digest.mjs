import { createHash } from 'node:crypto';
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  return value;
}
export const jsonDigest = value => createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
export const binaryDigest = value => createHash('sha256').update(value).digest('hex');

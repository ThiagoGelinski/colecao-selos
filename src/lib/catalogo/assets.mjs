import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { ASSET_DIR } from './paths.mjs';

export const ASSET_KINDS = ['frente', 'verso', 'card', 'thumb'];
export const REQUIRED_ASSETS = new Set(['frente', 'card']);
const exists = async (target) => access(target, constants.F_OK).then(() => true).catch(() => false);
export function validateAssetPath(id, kind, publicPath) {
  if (typeof publicPath !== 'string' || !publicPath) return { valid: false, error: `${kind}: caminho ausente.` };
  if (publicPath.includes('..') || publicPath.includes('\\') || publicPath.includes('%')) return { valid: false, error: `${kind}: caminho inseguro ou path traversal.` };
  const expected = `/assets/selos/${id}/${id}-${kind}.webp`;
  if (publicPath !== expected) return { valid: false, error: `${kind}: nome ou diretório inválido; esperado ${expected}.` };
  return { valid: true, absolute: path.join(ASSET_DIR, id, `${id}-${kind}.webp`) };
}
export async function validateAssets(record) {
  const results = [];
  for (const kind of ASSET_KINDS) {
    const publicPath = record.imagens?.[kind];
    if (!publicPath && !REQUIRED_ASSETS.has(kind)) continue;
    const checked = validateAssetPath(record.id, kind, publicPath);
    results.push({ kind, path: publicPath ?? null, path_valid: checked.valid, exists: checked.valid ? await exists(checked.absolute) : false, error: checked.error ?? null });
  }
  return results;
}
export function assetErrors(assets) { return assets.flatMap((asset) => !asset.path_valid ? [`asset ${asset.kind}: ${asset.error}`] : (!asset.exists ? [`asset ${asset.kind}: arquivo não encontrado (${asset.path}).`] : [])); }
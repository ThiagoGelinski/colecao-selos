import path from 'node:path';
import process from 'node:process';
import { readAssetBinary } from './io.mjs';

function contentType(filename) {
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

export async function serveCatalogAsset(id, filename) {
  if (!id || !filename || !/^SEL-[0-9]{6}$/.test(id)) return new Response('Not Found', { status: 404 });
  if ([id, filename].some((value) => value.includes('/') || value.includes('\\') || value.includes('..'))) return new Response('Not Found', { status: 404 });
  if (!new RegExp(`^${id}-(frente|verso|card|thumb)\\.(webp|png|jpg|jpeg)$`).test(filename)) return new Response('Not Found', { status: 404 });
  const mime = contentType(filename);
  if (!mime) return new Response('Not Found', { status: 404 });

  const target = path.join(process.cwd(), 'public', 'assets', 'selos', id, filename);
  try {
    const buffer = await readAssetBinary(target);
    return new Response(buffer, { status: 200, headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=300, must-revalidate', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.message?.includes('inválido')) return new Response('Not Found', { status: 404 });
    console.error('catalog_asset_serving_failed', { id, filename });
    return new Response('Internal Server Error', { status: 500 });
  }
}

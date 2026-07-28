import type { APIRoute } from 'astro';
import path from 'node:path';
import process from 'node:process';
import { readAssetBinary } from '../../../../lib/catalogo/io.mjs';

export const prerender = false;

function getContentTypeForExtension(filename: string): string | null {
    if (filename.endsWith('.webp')) return 'image/webp';
    if (filename.endsWith('.png')) return 'image/png';
    if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
    return null;
}

export const GET: APIRoute = async ({ params }) => {
    const { id, filename } = params;

    if (!id || !filename) {
        return new Response('Not Found', { status: 404 });
    }

    // Validation 1: Block traversal and arbitrary paths
    if (id.includes('/') || id.includes('\\') || id.includes('..') ||
        filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return new Response('Not Found', { status: 404 });
    }

    // Validation 2: Validate ID structure
    if (!/^SEL-[0-9]{6}$/.test(id)) {
        return new Response('Not Found', { status: 404 });
    }

    // Validation 3: Validate filename structure and ID match
    const filenameRegex = new RegExp(`^${id}-(frente|verso|card|thumb)\\.(webp|png|jpg|jpeg)$`);
    if (!filenameRegex.test(filename)) {
        return new Response('Not Found', { status: 404 });
    }

    const contentType = getContentTypeForExtension(filename);
    if (!contentType) {
        return new Response('Not Found', { status: 404 });
    }

    // The readAssetBinary expects the absolute path locally, or relative to the blob root.
    // In io.mjs, `target` is resolved through `getAssetBlobKey` which strictly matches:
    // `\/assets\/selos\/(SEL-[0-9]{6})\/(\1...`
    // So the input target MUST be formatted as a valid `/assets/selos/...` absolute or relative path string!

    // We construct a canonical path resolving to the public directory.
    // This allows `readFile` to find the bytes locally via Node fs, 
    // and naturally resolves the Regex `getAssetBlobKey` uses on Cloud.
    const targetString = path.join(process.cwd(), 'public', 'assets', 'selos', id, filename);

    try {
        const buffer = await readAssetBinary(targetString);

        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=300, must-revalidate'
            }
        });
    } catch (error: any) {
        if (error.code === 'ENOENT' || error.message.includes('inválido')) {
            return new Response('Not Found', { status: 404 });
        }

        // Let unexpected errors bubble or print server errors
        console.error(`Asset Server Error (${targetString}):`, error);
        return new Response('Internal Server Error', { status: 500 });
    }
};

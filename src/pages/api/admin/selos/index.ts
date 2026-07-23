import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse, safeApiFailure } from '../../../../lib/admin/api.mjs';
import { getAdminStamps } from '../../../../lib/admin/catalog-service';
export const prerender = false;
export const GET: APIRoute = async ({ url }) => {
  try {
    const result = await getAdminStamps({ q: url.searchParams.get('q') ?? '', status: url.searchParams.get('status') ?? '', sort: url.searchParams.get('sort') ?? 'id', direction: url.searchParams.get('direction') ?? 'asc', page: Number(url.searchParams.get('page') ?? 1), pageSize: Number(url.searchParams.get('pageSize') ?? 20) });
    return jsonResponse(apiPayload(result.items, { ...result.meta, filters: result.filters }));
  } catch (error) { return safeApiFailure(error); }
};

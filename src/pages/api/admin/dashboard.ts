import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse, safeApiFailure } from '../../../lib/admin/api.mjs';
import { getAdminDashboard } from '../../../lib/admin/catalog-service';
export const prerender = false;
export const GET: APIRoute = async () => { try { return jsonResponse(apiPayload(await getAdminDashboard())); } catch (error) { return safeApiFailure(error); } };

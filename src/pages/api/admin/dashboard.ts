import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse, safeApiFailure } from '../../../lib/admin/api.mjs';
import { getAdminDashboard } from '../../../lib/admin/catalog-service';
export const prerender = false;
export const GET: APIRoute = () => { try { return jsonResponse(apiPayload(getAdminDashboard())); } catch (error) { return safeApiFailure(error); } };

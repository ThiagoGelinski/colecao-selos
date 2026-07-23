import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse, safeApiFailure } from '../../../lib/admin/api.mjs';
import { getAdminConfigurationStatus } from '../../../lib/admin/catalog-service';
export const prerender = false;
export const GET: APIRoute = () => { try { return jsonResponse(apiPayload(getAdminConfigurationStatus())); } catch (error) { return safeApiFailure(error); } };

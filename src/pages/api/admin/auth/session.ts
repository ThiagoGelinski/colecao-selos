import type { APIRoute } from 'astro';
import { apiPayload, jsonResponse } from '../../../../lib/admin/api.mjs';
export const prerender = false;
export const GET: APIRoute = ({ locals }) => jsonResponse(apiPayload({ user: locals.adminUser }));

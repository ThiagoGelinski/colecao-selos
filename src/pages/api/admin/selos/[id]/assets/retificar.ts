import type { APIRoute } from 'astro';
import { PUT as retificar } from '../assets.ts';

export const prerender = false;
export const POST: APIRoute = retificar;

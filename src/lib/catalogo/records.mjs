import path from 'node:path';
import { DATA_DIR, ID_PATTERN } from './paths.mjs';
export function dataPath(id) { return path.join(DATA_DIR, `${id}.json`); }
export function normalizeSlug(value) { if (typeof value !== 'string') return ''; return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, ''); }
export function sequenceFromId(id) { return ID_PATTERN.test(id ?? '') ? Number.parseInt(id.slice(4), 10) : null; }
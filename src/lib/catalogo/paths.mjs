import path from 'node:path';
import process from 'node:process';

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, 'src', 'data', 'selos');
export const ASSET_DIR = path.join(ROOT, 'public', 'assets', 'selos');
export const REPORT_DIR = path.join(ROOT, 'reports');
export const LOG_DIR = path.join(ROOT, 'logs');
export const ID_MANIFEST = path.join(ROOT, 'manifests', 'ids.json');
export const ID_LOCK = path.join(ROOT, 'manifests', 'ids.lock');
export const TEMPLATE = path.join(ROOT, 'templates', 'selo.template.json');
export const ID_PATTERN = /^SEL-[0-9]{6}$/;
export const RESERVATION_STATUSES = new Set(['reservado', 'criando', 'criado', 'falha_na_criacao', 'cancelado_sem_reuso']);
export const LOCK_TIMEOUT_MS = Number.parseInt(process.env.SELO_LOCK_TIMEOUT_MS ?? '5000', 10);
export const LOCK_STALE_MS = Number.parseInt(process.env.SELO_LOCK_STALE_MS ?? '30000', 10);
export const LOCK_RETRY_MS = Number.parseInt(process.env.SELO_LOCK_RETRY_MS ?? '50', 10);
export const LOCK_REMOVE_DELAY_MS = Number.parseInt(process.env.SELO_TEST_LOCK_REMOVE_DELAY_MS ?? '0', 10);
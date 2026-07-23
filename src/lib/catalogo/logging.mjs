import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { LOG_DIR } from './paths.mjs';

let context = { command: null, transaction_id: null };
export function setLogContext(next = {}) { context = { ...context, ...next }; }
export function getLogContext() { return { ...context }; }
export async function appendLog(event, details = {}) {
  const normalized = {
    id: details.id ?? null, slug: details.slug ?? null,
    reviewer: details.reviewer ?? details.aprovado_por ?? null,
    previous_status: details.previous_status ?? details.status_anterior ?? null,
    new_status: details.new_status ?? details.status_novo ?? null,
    hash: details.hash ?? null, version: details.version ?? details.versao ?? null,
    error_code: details.error_code ?? null, message: details.message ?? null,
    ...Object.fromEntries(Object.entries(details).filter(([key]) => !['aprovado_por', 'status_anterior', 'status_novo', 'versao'].includes(key)))
  };
  await mkdir(LOG_DIR, { recursive: true });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), command: context.command, event, pid: process.pid, transaction_id: context.transaction_id, ...normalized });
  await writeFile(path.join(LOG_DIR, 'pipeline.jsonl'), `${line}\n`, { encoding: 'utf8', flag: 'a' });
}
import { readFile, readdir, rename, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ASSET_DIR, DATA_DIR, ID_LOCK, ID_MANIFEST, LOCK_STALE_MS, LOG_DIR, REPORT_DIR, ROOT } from './paths.mjs';
import { exists, readJson } from './io.mjs';
import { fileIdentity, isProcessActive, readLockSnapshot, readSnapshotAt, removeStaleLock, removeVerifiedFile, sameFileIdentity } from './lock.mjs';
import { inspectRecordFiles } from './records.mjs';
import { appendLog } from './logging.mjs';

const TEMP_PATTERN = /\.tmp$|\.transaction-|\.removal-/;
const FINAL_EVENTS = new Set(['selo_novo', 'selo_novo_falha', 'selo_revisao', 'selo_aprovar', 'selo_rejeitar', 'selo_revogar', 'selo_publicar', 'aprovacao_invalidada', 'catalogo_manutencao', 'erro']);
async function scanDirectory(directory, { recursive = false } = {}) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (TEMP_PATTERN.test(entry.name) || entry.name.startsWith('.removal-') || entry.name.startsWith('ids.lock.removal-')) {
      const details = await stat(target).catch(() => null); if (details) found.push({ kind: entry.isDirectory() ? 'removal_directory' : 'temporary', path: path.relative(ROOT, target), absolute: target, is_directory: entry.isDirectory(), age_ms: Date.now() - details.mtimeMs, safe_to_clean: Date.now() - details.mtimeMs > LOCK_STALE_MS, identity: fileIdentity(details) });
    }
    if (recursive && entry.isDirectory() && !TEMP_PATTERN.test(entry.name)) found.push(...await scanDirectory(target, { recursive }));
  }
  return found;
}
export async function operationalResidues() {
  const residues = [];
  for (const directory of [path.dirname(ID_MANIFEST), DATA_DIR, ASSET_DIR, REPORT_DIR, LOG_DIR]) residues.push(...await scanDirectory(directory, { recursive: directory === ASSET_DIR }));
  const invalidReports = [];
  for (const name of await readdir(REPORT_DIR).catch(() => [])) if (name.endsWith('.json')) { const target = path.join(REPORT_DIR, name); try { await readJson(target); } catch (error) { invalidReports.push({ path: path.relative(ROOT, target), error: error.message }); } }
  const invalidLogLines = []; const transactions = new Map(); const logPath = path.join(LOG_DIR, 'pipeline.jsonl');
  if (await exists(logPath)) { const lines = (await readFile(logPath, 'utf8')).split(/\r?\n/).filter(Boolean); for (const [index, line] of lines.entries()) { try { const event = JSON.parse(line); if (event.transaction_id) { const entry = transactions.get(event.transaction_id) ?? []; entry.push(event); transactions.set(event.transaction_id, entry); } } catch (error) { invalidLogLines.push({ line: index + 1, error: error.message }); } } }
  const unfinishedTransactions = [...transactions.entries()].filter(([, events]) => !events.some((event) => FINAL_EVENTS.has(event.event))).map(([transaction_id, events]) => ({ transaction_id, command: events[0]?.command ?? null }));
  const recordIds = new Set((await inspectRecordFiles()).filter((item) => !item.parse_error).map((item) => item.record.id));
  let manifest = null; try { manifest = await readJson(ID_MANIFEST); } catch {}
  const reservationIds = new Set(Array.isArray(manifest?.reserved) ? manifest.reserved.map((item) => item.id) : []);
  const assetDirectories = [];
  for (const name of await readdir(ASSET_DIR).catch(() => [])) { const target = path.join(ASSET_DIR, name); const details = await stat(target).catch(() => null); if (!details?.isDirectory() || TEMP_PATTERN.test(name)) continue; const files = await readdir(target).catch(() => []); const webpOutsidePattern = files.filter((file) => file.toLowerCase().endsWith('.webp') && !new RegExp(`^${name}-(frente|verso|card|thumb)\\.webp$`).test(file)); assetDirectories.push({ id: name, path: path.relative(ROOT, target), orphan: !recordIds.has(name), without_reservation: !reservationIds.has(name), empty: files.length === 0, valid_record: recordIds.has(name), webp_outside_pattern: webpOutsidePattern }); }
  return { residues, invalid_reports: invalidReports, invalid_log_lines: invalidLogLines, unfinished_transactions: unfinishedTransactions, asset_directories: assetDirectories };
}
export async function diagnoseLock() { const snapshot = await readLockSnapshot(); if (!snapshot) return { exists: false, pid: null, active: false, stale: false, age_ms: null }; const timestamp = Date.parse(snapshot.metadata?.timestamp ?? ''); const active = isProcessActive(snapshot.metadata?.pid); return { exists: true, pid: snapshot.metadata?.pid ?? null, active, stale: Number.isFinite(timestamp) && Date.now() - timestamp > LOCK_STALE_MS && !active, age_ms: Number.isFinite(timestamp) ? Date.now() - timestamp : null }; }
async function removeVerifiedEmptyDirectory(item) { if (!item.safe_to_clean || !item.is_directory) return false; const current = fileIdentity(await stat(item.absolute).catch(() => null)); if (!sameFileIdentity(current, item.identity) || (await readdir(item.absolute).catch(() => ['unknown'])).length) return false; const quarantine = `${item.absolute}.maintenance-${process.pid}`; try { await rename(item.absolute, quarantine); } catch { return false; } const moved = fileIdentity(await stat(quarantine).catch(() => null)); if (!sameFileIdentity(moved, item.identity)) { await rename(quarantine, item.absolute).catch(() => {}); return false; } await rmdir(quarantine); return true; }
export async function runMaintenance({ clean = false, dryRun = false } = {}) {
  const lock = await diagnoseLock(); const operational = await operationalResidues(); const removed = []; const blocked = [];
  if (clean && lock.active) blocked.push('Lock ativo não pode ser removido.');
  if (clean && !dryRun) {
    for (const item of operational.residues) {
      if (!item.safe_to_clean) { blocked.push(`Artefato recente preservado: ${item.path}.`); continue; }
      const removedItem = item.is_directory ? await removeVerifiedEmptyDirectory(item) : await removeVerifiedFile(item.absolute, await readSnapshotAt(item.absolute), () => true, 'maintenance');
      if (removedItem) { removed.push(item.path); await appendLog('maintenance_removed', { message: item.path }); } else { blocked.push(`Identidade/conteúdo não comprovado; preservado: ${item.path}.`); await appendLog('maintenance_blocked', { message: item.path }); }
    }
    if (lock.stale) { if (await removeStaleLock(await readLockSnapshot())) { const item = path.relative(ROOT, ID_LOCK); removed.push(item); await appendLog('maintenance_removed', { message: item }); } else blocked.push('Lock obsoleto não removido por divergência de identidade.'); }
  }
  return { mode: dryRun ? 'dry-run' : (clean ? 'clean' : 'diagnostic'), lock, ...operational, residues: operational.residues.map(({ absolute: _absolute, identity: _identity, ...item }) => item), removed, blocked };
}
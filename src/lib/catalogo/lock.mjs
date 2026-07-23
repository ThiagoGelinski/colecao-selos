import { link, open, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { ID_LOCK, LOCK_REMOVE_DELAY_MS, LOCK_RETRY_MS, LOCK_STALE_MS, LOCK_TIMEOUT_MS } from './paths.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
export function isProcessActive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } }
export function fileIdentity(details) { return details ? { dev: details.dev, ino: details.ino } : null; }
export function sameFileIdentity(left, right) { return Boolean(left && right && left.dev === right.dev && left.ino === right.ino); }
export async function readSnapshotAt(target) {
  let handle;
  try {
    handle = await open(target, 'r');
    const details = await handle.stat();
    const raw = await handle.readFile('utf8');
    let metadata = null;
    try { metadata = JSON.parse(raw); } catch { metadata = { timestamp: details.mtime.toISOString() }; }
    return { raw, metadata, identity: fileIdentity(details) };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}
export const readLockSnapshot = () => readSnapshotAt(ID_LOCK);
async function restoreQuarantinedPath(quarantine, target) { try { await link(quarantine, target); await unlink(quarantine); return true; } catch (error) { if (error.code !== 'EEXIST') throw error; return false; } }
export async function removeVerifiedFile(target, snapshot, ownershipCheck, tokenHint = 'unknown') {
  if (!snapshot || !ownershipCheck(snapshot.metadata)) return false;
  const currentIdentity = fileIdentity(await stat(target).catch(() => null));
  if (!sameFileIdentity(currentIdentity, snapshot.identity)) return false;
  if (LOCK_REMOVE_DELAY_MS > 0) await sleep(LOCK_REMOVE_DELAY_MS);
  const quarantine = `${target}.removal-${process.pid}-${tokenHint}-${randomUUID()}`;
  try { await rename(target, quarantine); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const moved = await readSnapshotAt(quarantine);
  const proven = moved && sameFileIdentity(moved.identity, snapshot.identity) && moved.raw === snapshot.raw && ownershipCheck(moved.metadata);
  if (!proven) { await restoreQuarantinedPath(quarantine, target); return false; }
  await unlink(quarantine);
  return true;
}
export async function removeStaleLock(snapshot) {
  if (!snapshot) return false;
  return removeVerifiedFile(ID_LOCK, snapshot, (metadata) => { const timestamp = Date.parse(metadata?.timestamp ?? ''); return Number.isFinite(timestamp) && Date.now() - timestamp > LOCK_STALE_MS && !isProcessActive(metadata?.pid); }, snapshot.metadata?.token ?? 'stale');
}
export async function acquireIdLock(command) {
  if (!Number.isFinite(LOCK_TIMEOUT_MS) || LOCK_TIMEOUT_MS < 0 || !Number.isFinite(LOCK_STALE_MS) || LOCK_STALE_MS < 1 || !Number.isFinite(LOCK_RETRY_MS) || LOCK_RETRY_MS < 1) throw new Error('Configuração de lock inválida.');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const metadata = { pid: process.pid, timestamp: new Date().toISOString(), command, token: randomUUID() };
  while (true) {
    try { const handle = await open(ID_LOCK, 'wx'); try { await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'); } finally { await handle.close(); } return metadata; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await removeStaleLock(await readLockSnapshot())) continue;
      if (Date.now() >= deadline) throw new Error(`Timeout ao adquirir lock de IDs após ${LOCK_TIMEOUT_MS}ms.`);
      await sleep(Math.min(LOCK_RETRY_MS, Math.max(1, deadline - Date.now())));
    }
  }
}
export async function releaseIdLock(owner) { return removeVerifiedFile(ID_LOCK, await readLockSnapshot(), (metadata) => metadata?.token === owner.token && metadata?.pid === owner.pid, owner.token); }
export async function withIdLock(command, operation) { const owner = await acquireIdLock(command); try { return await operation(owner); } finally { await releaseIdLock(owner); } }
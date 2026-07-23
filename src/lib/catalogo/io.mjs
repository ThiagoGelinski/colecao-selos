import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
export const exists = async (target) => access(target, constants.F_OK).then(() => true).catch(() => false);
export const readJson = async (target) => JSON.parse(await readFile(target, 'utf8'));
export async function writeJsonAtomic(target, value) { await mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await rename(temporary, target); }
#!/usr/bin/env node

import process from 'node:process';
import { appendLog, availableCommands, executeCommand, parseArgs } from '../src/lib/catalogo/commands.mjs';
import { EXIT_CODES, normalizeError } from '../src/lib/catalogo/errors.mjs';
import { captureOutput, failureEnvelope, successEnvelope } from '../src/lib/catalogo/output.mjs';

const command = process.argv[2];
const argv = process.argv.slice(3);
const parsed = parseArgs(argv);
const jsonMode = parsed.json === true;
const debug = parsed.debug === true || process.env.SELO_DEBUG === '1';

try {
  if (!command) throw Object.assign(new Error(`Comando inválido. Disponíveis: ${availableCommands().join(', ')}`), { code: 'CLI_USAGE', exitCode: EXIT_CODES.usage, details: { available: availableCommands() } });
  if (jsonMode) {
    const data = await captureOutput(() => executeCommand(command, argv));
    process.stdout.write(`${JSON.stringify(successEnvelope(command, data), null, 2)}\n`);
  } else {
    await executeCommand(command, argv);
  }
} catch (caught) {
  const error = normalizeError(caught);
  await appendLog('erro', { command, error_code: error.code, message: error.message }).catch(() => {});
  if (jsonMode) process.stdout.write(`${JSON.stringify(failureEnvelope(command, error), null, 2)}\n`);
  else {
    process.stderr.write(`${error.message}\n`);
    if (debug) process.stderr.write(`${caught?.stack ?? error.stack}\n`);
  }
  process.exitCode = error.exitCode;
}
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
    const { result, captured } = await captureOutput(() => executeCommand(command, argv));
    if (result?.ok === false || result?.exitCode !== 0) {
      const error = result?.error ?? { code: 'VALIDATION_ERROR', message: 'Comando falhou.', details: { data: result?.data ?? captured } };
      process.stdout.write(`${JSON.stringify(failureEnvelope(command, error), null, 2)}\n`);
      process.exitCode = result?.exitCode ?? EXIT_CODES.validation;
    } else {
      process.stdout.write(`${JSON.stringify(successEnvelope(command, result?.data ?? captured, result?.warnings ?? []), null, 2)}\n`);
      process.exitCode = EXIT_CODES.success;
    }
  } else {
    const result = await executeCommand(command, argv);
    process.exitCode = result?.exitCode ?? EXIT_CODES.success;
  }
} catch (caught) {
  const error = normalizeError(caught);
  await appendLog('erro', { error_code: error.code, message: error.message }).catch(() => {});
  if (jsonMode) process.stdout.write(`${JSON.stringify(failureEnvelope(command, error), null, 2)}\n`);
  else { process.stderr.write(`${error.message}\n`); if (debug) process.stderr.write(`${caught?.stack ?? error.stack}\n`); }
  process.exitCode = error.exitCode;
}
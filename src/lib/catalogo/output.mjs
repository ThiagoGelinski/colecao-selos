export function successEnvelope(command, data = {}, warnings = []) { return { ok: true, command, data, warnings }; }
export function failureEnvelope(command, error) { return { ok: false, command: command ?? null, error: { code: error.code, message: error.message, details: error.details ?? {} } }; }
export async function captureOutput(operation) {
  const lines = []; const original = console.log; console.log = (...values) => lines.push(values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
  try { const result = await operation(); let captured = {}; if (lines.length === 1) { try { captured = JSON.parse(lines[0]); } catch { captured = { message: lines[0] }; } } else if (lines.length > 1) captured = { output: lines }; return { result, captured }; }
  finally { console.log = original; }
}
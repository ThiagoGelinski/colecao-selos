export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface CommandError { code: string; message: string; details: Record<string, unknown>; }
export interface SuccessEnvelope<T = unknown> { ok: true; command: string; data: T; warnings: string[]; }
export interface FailureEnvelope { ok: false; command: string | null; error: CommandError; }
export function availableCommands(): string[];
export function executeCommand(command: string, argv?: string[]): Promise<unknown>;
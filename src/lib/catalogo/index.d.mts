export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface CommandError { code: string; message: string; details: Record<string, unknown>; }
export interface CommandResult<T = unknown> { ok: boolean; data: T; warnings: string[]; error?: CommandError; exitCode: ExitCode; }
export interface SuccessEnvelope<T = unknown> { ok: true; command: string; data: T; warnings: string[]; }
export interface FailureEnvelope { ok: false; command: string | null; error: CommandError; }
export function availableCommands(): string[];
export function executeCommand<T = unknown>(command: string, argv?: string[]): Promise<CommandResult<T>>;
export interface ValidationIssue {
  type: 'schema' | 'semantic' | 'editorial';
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}
export interface ValidationLayer { valid: boolean; errors: ValidationIssue[]; }
export interface SeloValidationResult extends ValidationLayer {
  structural: ValidationLayer;
  semantic: ValidationLayer;
  editorial: ValidationLayer;
}
export function approvedContent(record: Record<string, unknown>): Record<string, unknown>;
export function recordHash(record: Record<string, unknown>): string;
export function validateSeloSchema(value: unknown): ValidationLayer;
export function validateSeloSemantics(value: unknown): ValidationLayer;
export function validateSeloEditorial(value: unknown): ValidationLayer;
export function validateSeloData(value: unknown): SeloValidationResult;
export function formatValidationIssue(error: ValidationIssue): string;
export function assertSeloData<T>(value: T, source?: string): T;
export function schemaIsCompiled(): boolean;

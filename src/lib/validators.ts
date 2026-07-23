import { assertSeloData } from './selo-validation.mjs';
import type { Selo } from '../types/selo';

export function validateSelo(value: unknown, source = 'registro'): asserts value is Selo {
  assertSeloData(value, source);
}
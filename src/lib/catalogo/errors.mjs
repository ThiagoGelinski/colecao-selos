export const EXIT_CODES = Object.freeze({ success: 0, validation: 1, usage: 2, integrity: 3, lock: 4, transaction: 5, approval: 6, asset: 7, internal: 8 });

export class CatalogError extends Error {
  constructor(message, { code = 'CATALOG_ERROR', details = {}, cause, exitCode = EXIT_CODES.internal } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export class ValidationError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'VALIDATION_ERROR', exitCode: EXIT_CODES.validation, ...options }); } }
export class ManifestError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'MANIFEST_ERROR', exitCode: EXIT_CODES.integrity, ...options }); } }
export class LockError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'LOCK_ERROR', exitCode: EXIT_CODES.lock, ...options }); } }
export class TransactionError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'TRANSACTION_ERROR', exitCode: EXIT_CODES.transaction, ...options }); } }
export class RecordNotFoundError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'RECORD_NOT_FOUND', exitCode: EXIT_CODES.validation, ...options }); } }
export class IntegrityError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'INTEGRITY_ERROR', exitCode: EXIT_CODES.integrity, ...options }); } }
export class ApprovalError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'APPROVAL_ERROR', exitCode: EXIT_CODES.approval, ...options }); } }
export class PublicationError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'PUBLICATION_ERROR', exitCode: EXIT_CODES.approval, ...options }); } }
export class AssetError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'ASSET_ERROR', exitCode: EXIT_CODES.asset, ...options }); } }
export class UsageError extends CatalogError { constructor(message, options = {}) { super(message, { code: 'CLI_USAGE', exitCode: EXIT_CODES.usage, ...options }); } }

export function normalizeError(error) {
  if (error instanceof CatalogError || (error?.code && Number.isInteger(error?.exitCode))) return error;
  const message = error?.message ?? String(error);
  if (/uso:|comando inválido|informe um ID/i.test(message)) return new UsageError(message, { cause: error });
  if (/lock|concorrência|timeout ao adquirir/i.test(message)) return new LockError(message, { cause: error });
  if (/manifesto|integridade|duplicad|ambíguo/i.test(message)) return new IntegrityError(message, { cause: error });
  if (/aprova|publica|rejei|revoga/i.test(message)) return new ApprovalError(message, { cause: error });
  if (/asset|webp|imagem/i.test(message)) return new AssetError(message, { cause: error });
  if (/transa|compensa|criação bloqueada|falha de teste/i.test(message)) return new TransactionError(message, { cause: error });
  return new ValidationError(message, { cause: error });
}
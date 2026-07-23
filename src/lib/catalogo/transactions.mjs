import { randomUUID } from 'node:crypto';
const MUTABLE = /^(selo:(novo|revisao|aprovar|rejeitar|revogar|publicar)|catalogo:manutencao)$/;
export function transactionIdFor(command) { return MUTABLE.test(command) ? randomUUID() : null; }
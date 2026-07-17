/**
 * Barrel do `shared/lib` (F56-S29). Ponto de entrada para os utilitários PUROS
 * e seguros em Server e Client Components.
 *
 * Regra: só re-exportar módulos sem `'use client'` e sem efeito colateral de
 * runtime de browser (evita o "barrel client→server leak" — ver MEMORY F10).
 * Módulos com estado de cliente (session-expiry, query-client, supabase-browser)
 * continuam sendo importados pelo caminho-folha, nunca por este índice.
 */
export { ApiError } from './api-client';
export type { ApiIssue } from './api-client';
export { api } from './api-client';
export { describeApiError } from './api-error-message';
export type { ApiErrorMessage } from './api-error-message';

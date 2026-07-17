/**
 * Contexto request-scoped para correlação de log (F56-S20).
 *
 * Usa `AsyncLocalStorage` para propagar `requestId`/`workspaceId` por toda a
 * árvore async de uma request sem precisar carregar o logger manualmente em
 * cada camada. O `createLogger` (index.ts) mixa este contexto em TODA linha de
 * log via `mixin`, então qualquer logger — inclusive os criados no load de
 * módulo (webhookLogger, connectLogger, …) — passa a carregar os ids
 * automaticamente quando executado dentro de `runWithLogContext`.
 *
 * O pacote permanece agnóstico de Express: o contexto é um objeto simples e o
 * `workspaceId` pode ser um valor OU um getter (resolvido tarde, depois do
 * middleware de auth popular a sessão). Workers podem usar o mesmo mecanismo
 * por job (follow-up — a interface já está pronta aqui).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  readonly requestId?: string;
  readonly workspaceId?: string;
  readonly [key: string]: unknown;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Executa `fn` com o contexto de log ativo; propaga por toda a árvore async. */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Contexto corrente (ou `undefined` fora de uma request instrumentada). */
export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

/**
 * Snapshot dos campos correntes, com getters resolvidos e `undefined`
 * descartados — pronto para mixar no objeto de log do Pino. Barato: só roda
 * quando há uma linha de log de fato (via `mixin`).
 */
export function resolveLogContext(): Record<string, unknown> {
  const ctx = storage.getStore();
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

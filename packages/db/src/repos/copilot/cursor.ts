/**
 * Paginação keyset dos repos do Copiloto (F73-S01).
 *
 * O cursor é opaco para o cliente: `base64url(JSON [ts, id])`. O `ts` sai do PRÓPRIO Postgres
 * com microssegundos (`to_char(... 'US')`), nunca de um `Date` do JS — um `Date` trunca para
 * milissegundos e o keyset `(ts, id) < (cursor)` pularia ou repetiria linhas gravadas no mesmo
 * milissegundo. O desempate por `id` torna a ordem total.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Cursor malformado (ou adulterado). A API responde 400; nunca vira "primeira página". */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid_cursor');
    this.name = 'InvalidCursorError';
  }
}

export interface KeysetCursor {
  /** Instante UTC com microssegundos: `YYYY-MM-DDTHH:MM:SS.uuuuuuZ`. */
  readonly ts: string;
  readonly id: string;
}

/** Página de resultados. `nextCursor` null = não há mais. */
export interface CopilotPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.ts, cursor.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new InvalidCursorError();
  const [ts, id] = parsed as unknown[];
  if (typeof ts !== 'string' || !TS_RE.test(ts)) throw new InvalidCursorError();
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new InvalidCursorError();
  return { ts, id: id.toLowerCase() };
}

/** Limite inteiro em [1, max]; ausente/inválido = `fallback`. */
export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return Math.min(fallback, max);
  return Math.max(1, Math.min(max, Math.trunc(limit)));
}

/** Instante da coluna como texto UTC com microssegundos (a chave do cursor). */
export function cursorTs(col: AnyPgColumn): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** `(ts, id) < cursor` — próxima página em ordem DESC. */
export function beforeCursor(tsCol: AnyPgColumn, idCol: AnyPgColumn, cursor: KeysetCursor): SQL {
  return sql`(${tsCol}, ${idCol}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`;
}

/**
 * Fecha a página a partir de `limit + 1` linhas lidas (a extra só diz se há mais). Remove a
 * coluna auxiliar `cursorTs` do resultado.
 */
export function toPage<R extends { readonly id: string; readonly cursorTs: string }>(
  rows: readonly R[],
  limit: number,
): CopilotPage<Omit<R, 'cursorTs'>> {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeCursor({ ts: last.cursorTs, id: last.id })
      : null;
  const items = page.map((r) => {
    const { cursorTs, ...rest } = r;
    void cursorTs;
    return rest;
  });
  return { items, nextCursor };
}

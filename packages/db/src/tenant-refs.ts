/**
 * Referências entre workspaces nas rotas de escrita (F70-S11).
 *
 * ## O buraco que isto fecha
 *
 * As rotas de escrita rodam sob `withWorkspace` (papel `hm_app`, FORCE RLS), mas a
 * checagem de FK do Postgres roda FORA da RLS: um `INSERT deals (contact_id = <id de B>)`
 * feito pelo workspace A passa, porque a FK só pergunta "o id existe em algum lugar?".
 * Consequências: dado de A pendurado em linha de B (exclusões de B cascateiam em A),
 * índices únicos globais ocupados por A em nome de B (`uq_deals_conversation`,
 * `stages_pipeline_position_uq`) e o par 500/201 servindo de oráculo de existência de UUID.
 *
 * ## O contrato
 *
 * `assertRefsInWorkspace(tx, refs)` confere, numa ÚNICA consulta (`UNION ALL` de um
 * `SELECT` por tipo, ids agrupados), que cada id existe NO workspace corrente. Devolve os
 * ausentes. "Não existe" e "é de outro workspace" são indistinguíveis por construção: as
 * duas situações caem na mesma lista, e o chamador responde com um corpo só
 * (`TenantRefError.body`).
 *
 * Defesa em camadas: a consulta roda sob a RLS do `tx` E filtra explicitamente por
 * `workspace_id = app_current_workspace()`. Se alguém a chamar fora de `withWorkspace`
 * (papel owner, que ignora RLS), o filtro explícito ainda fecha: sem GUC, o helper devolve
 * NULL e TODOS os ids saem como ausentes (fail-closed), nunca como presentes.
 *
 * A correção estrutural (FKs compostas `(workspace_id, id)`) é a F70-S12; este módulo é a
 * trava na aplicação, que também dá ao cliente um 422 limpo em vez de um 500.
 */
import { inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbTx } from './client';
import {
  agents,
  calendars,
  channels,
  contacts,
  conversionTypes,
  conversations,
  deals,
  flows,
  kbChunks,
  kbDocuments,
  members,
  pipelines,
  stages,
  tags,
  teams,
} from './schema';

/** Tipos de referência validáveis. Cada um aponta para uma tabela com `workspace_id`. */
export type TenantRefKind =
  | 'agent'
  | 'calendar'
  | 'channel'
  | 'contact'
  | 'conversation'
  | 'conversionType'
  | 'deal'
  | 'flow'
  | 'kbChunk'
  | 'kbDocument'
  | 'member'
  | 'pipeline'
  | 'stage'
  | 'tag'
  | 'team';

/** Id opcional: `null`/`undefined` significa "campo não enviado" e é ignorado. */
type MaybeId = string | null | undefined;

/**
 * Uma referência a conferir. `field` é o nome do campo na entrada externa (ex.:
 * `ownerId`), devolvido ao cliente para ele saber o que corrigir.
 *
 * `stage` aceita `pipelineId`: quando vem, o estágio só conta como presente se for DESTE
 * pipeline (um estágio de outro pipeline do mesmo workspace é tão inválido quanto um id
 * de outro tenant, e responde igual).
 */
export type TenantRef =
  | {
      readonly kind: 'stage';
      readonly id: MaybeId;
      readonly field: string;
      readonly pipelineId?: MaybeId;
    }
  | {
      readonly kind: Exclude<TenantRefKind, 'stage'>;
      readonly id: MaybeId;
      readonly field: string;
    };

/** Referência ausente do workspace corrente (não existe OU é de outro tenant). */
export interface MissingRef {
  readonly kind: TenantRefKind;
  readonly id: string;
  readonly field: string;
}

interface RefTable {
  readonly table: PgTable;
  readonly id: PgColumn;
  readonly workspaceId: PgColumn;
  /** Coluna-pai conferida junto (só `stage.pipeline_id`). */
  readonly parent?: PgColumn;
}

const REF_TABLES: Readonly<Record<TenantRefKind, RefTable>> = {
  agent: { table: agents, id: agents.id, workspaceId: agents.workspaceId },
  calendar: { table: calendars, id: calendars.id, workspaceId: calendars.workspaceId },
  channel: { table: channels, id: channels.id, workspaceId: channels.workspaceId },
  contact: { table: contacts, id: contacts.id, workspaceId: contacts.workspaceId },
  conversation: {
    table: conversations,
    id: conversations.id,
    workspaceId: conversations.workspaceId,
  },
  conversionType: {
    table: conversionTypes,
    id: conversionTypes.id,
    workspaceId: conversionTypes.workspaceId,
  },
  deal: { table: deals, id: deals.id, workspaceId: deals.workspaceId },
  flow: { table: flows, id: flows.id, workspaceId: flows.workspaceId },
  kbChunk: { table: kbChunks, id: kbChunks.id, workspaceId: kbChunks.workspaceId },
  kbDocument: { table: kbDocuments, id: kbDocuments.id, workspaceId: kbDocuments.workspaceId },
  member: { table: members, id: members.id, workspaceId: members.workspaceId },
  pipeline: { table: pipelines, id: pipelines.id, workspaceId: pipelines.workspaceId },
  stage: {
    table: stages,
    id: stages.id,
    workspaceId: stages.workspaceId,
    parent: stages.pipelineId,
  },
  tag: { table: tags, id: tags.id, workspaceId: tags.workspaceId },
  team: { table: teams, id: teams.id, workspaceId: teams.workspaceId },
};

/**
 * UUID canônico (qualquer versão). Um id fora do formato nunca chega ao Postgres: o cast
 * estouraria `22P02` e abortaria a transação RLS inteira; aqui ele só vira "ausente".
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeId(id: string): string {
  return id.toLowerCase();
}

/**
 * Confere que cada id de `refs` existe no workspace corrente do `tx`. Devolve os
 * ausentes, na ordem de `refs` (lista vazia = tudo certo).
 *
 * Uma única ida ao banco, qualquer que seja o número de refs: um `SELECT` por TIPO
 * (ids agrupados em `IN (...)`), costurados em `UNION ALL`. Refs sem id são ignoradas.
 *
 * Deve rodar dentro de `withWorkspace` / `req.scoped`.
 */
export async function assertRefsInWorkspace(
  tx: DbTx,
  refs: readonly TenantRef[],
): Promise<MissingRef[]> {
  const wanted = refs.filter(
    (r): r is TenantRef & { readonly id: string } => typeof r.id === 'string' && r.id !== '',
  );
  if (wanted.length === 0) return [];

  // Agrupa ids válidos por tipo (dedup). Ids malformados nem entram na consulta.
  const idsByKind = new Map<TenantRefKind, Set<string>>();
  for (const ref of wanted) {
    if (!UUID_RE.test(ref.id)) continue;
    const set = idsByKind.get(ref.kind) ?? new Set<string>();
    set.add(normalizeId(ref.id));
    idsByKind.set(ref.kind, set);
  }

  // Presentes: chave `kind:id` → pipeline do estágio (null nos demais tipos).
  const found = new Map<string, string | null>();
  if (idsByKind.size > 0) {
    const parts: SQL[] = [];
    for (const [kind, ids] of idsByKind) {
      const t = REF_TABLES[kind];
      const parent = t.parent ? sql`${t.parent}::text` : sql`null::text`;
      parts.push(
        sql`select ${kind}::text as kind, ${t.id}::text as id, ${parent} as parent
              from ${t.table}
             where ${t.workspaceId} = app_current_workspace()
               and ${inArray(t.id, [...ids])}`,
      );
    }
    const rows = await tx.execute<{ kind: string; id: string; parent: string | null }>(
      sql.join(parts, sql` union all `),
    );
    for (const row of rows) {
      found.set(`${row.kind}:${normalizeId(row.id)}`, row.parent);
    }
  }

  const missing: MissingRef[] = [];
  for (const ref of wanted) {
    const key = `${ref.kind}:${normalizeId(ref.id)}`;
    const present = UUID_RE.test(ref.id) && found.has(key);
    let ok = present;
    if (ok && ref.kind === 'stage' && typeof ref.pipelineId === 'string') {
      const parent = found.get(key);
      ok = parent != null && normalizeId(parent) === normalizeId(ref.pipelineId);
    }
    if (!ok) missing.push({ kind: ref.kind, id: ref.id, field: ref.field });
  }
  return missing;
}

/** Corpo HTTP único de referência inválida (sem oráculo: igual para "não existe" e "é de outro"). */
export interface InvalidReferenceBody {
  readonly error: 'invalid_reference';
  readonly message: string;
  readonly fields: readonly string[];
}

/**
 * Erro de referência inválida. Rotas o mapeiam a **422** com `body`. O corpo lista só os
 * NOMES dos campos (nunca diz se o id existe em outro workspace): quem manda o id de
 * outro tenant recebe exatamente a mesma resposta de quem manda um UUID aleatório.
 */
export class TenantRefError extends Error {
  readonly missing: readonly MissingRef[];
  readonly body: InvalidReferenceBody;

  constructor(missing: readonly MissingRef[]) {
    const fields = [...new Set(missing.map((m) => m.field))].sort();
    super(`invalid_reference: ${fields.join(', ')}`);
    this.name = 'TenantRefError';
    this.missing = missing;
    this.body = invalidReferenceBody(fields);
  }
}

/** Monta o corpo 422 canônico para os campos informados. */
export function invalidReferenceBody(fields: readonly string[]): InvalidReferenceBody {
  const sorted = [...new Set(fields)].sort();
  return {
    error: 'invalid_reference',
    message:
      'Não foi possível salvar porque um ou mais registros referenciados não foram encontrados neste workspace. ' +
      'Os ids precisam apontar para registros do próprio workspace. ' +
      `Confira os campos: ${sorted.join(', ')}.`,
    fields: sorted,
  };
}

/** Como `assertRefsInWorkspace`, mas lança `TenantRefError` quando falta algo. */
export async function requireRefsInWorkspace(
  tx: DbTx,
  refs: readonly TenantRef[],
): Promise<void> {
  const missing = await assertRefsInWorkspace(tx, refs);
  if (missing.length > 0) throw new TenantRefError(missing);
}

/**
 * Nome do índice/constraint violado quando `err` é um `unique_violation` (23505), senão
 * `null`. O Drizzle embrulha o erro do driver num `DrizzleQueryError` (original em
 * `cause`), então olha os dois níveis.
 */
export function uniqueViolationConstraint(err: unknown): string | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 3 && typeof cur === 'object' && cur !== null; depth += 1) {
    const rec = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (rec.code === '23505') {
      return typeof rec.constraint_name === 'string' ? rec.constraint_name : '';
    }
    cur = rec.cause;
  }
  return null;
}

/**
 * Turnos e chamadas de ferramenta do Copiloto (F73-S01, ADR-003 §2–§3).
 *
 * O turno é a CREDENCIAL das ferramentas: `claimToolCall` é o passo 3 da reautorização do
 * callback interno — um único `UPDATE` atômico que confere dono, nonce do grant, estado, validade
 * e teto de chamadas, e já consome uma chamada. Sem leitura-e-depois-escrita: 20 chamadas
 * paralelas contra `max_tool_calls = 16` dão exatamente 16 sucessos.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotToolCalls,
  copilotTurns,
  type CopilotJsonObject,
  type CopilotRiskLevel,
  type CopilotToolCallDecision,
  type CopilotToolCallRow,
  type CopilotTurnFailureStatus,
  type CopilotTurnRow,
} from '../../schema/copilot';

export interface CreateRunningTurnInput {
  workspaceId: string;
  memberId: string;
  sessionId: string;
  grantNonce: string;
  expiresAt: Date;
  maxToolCalls: number;
  model?: string | null;
  /** Idempotência do POST: o mesmo id devolve o turno já criado. */
  clientRequestId?: string | null;
}

/**
 * Cria o turno `running`. Com `clientRequestId` repetido (mesmo membro), NÃO cria outro: devolve
 * o existente com `created=false` (o reenvio do cliente não abre um segundo turno nem cobra duas
 * vezes).
 */
async function createRunning(
  tx: DbTx,
  input: CreateRunningTurnInput,
): Promise<{ turn: CopilotTurnRow; created: boolean }> {
  const values = {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    sessionId: input.sessionId,
    grantNonce: input.grantNonce,
    expiresAt: input.expiresAt,
    maxToolCalls: input.maxToolCalls,
    model: input.model ?? null,
    clientRequestId: input.clientRequestId ?? null,
  };
  if (values.clientRequestId === null) {
    const [row] = await tx.insert(copilotTurns).values(values).returning();
    if (!row) throw new Error('copilot: turno não materializou.');
    return { turn: row, created: true };
  }
  const [inserted] = await tx
    .insert(copilotTurns)
    .values(values)
    .onConflictDoNothing({
      target: [copilotTurns.workspaceId, copilotTurns.memberId, copilotTurns.clientRequestId],
      where: sql`${copilotTurns.clientRequestId} is not null`,
    })
    .returning();
  if (inserted) return { turn: inserted, created: true };
  const [existing] = await tx
    .select()
    .from(copilotTurns)
    .where(
      and(
        eq(copilotTurns.workspaceId, input.workspaceId),
        eq(copilotTurns.memberId, input.memberId),
        eq(copilotTurns.clientRequestId, values.clientRequestId),
      ),
    );
  if (!existing) throw new Error('copilot: turno idempotente não encontrado após conflito.');
  return { turn: existing, created: false };
}

/** O que o callback precisa saber do turno depois de consumir a chamada. */
export interface ClaimedToolCall {
  readonly turnId: string;
  readonly workspaceId: string;
  readonly memberId: string;
  readonly sessionId: string;
  /** Já incrementado: esta é a chamada nº `toolCalls`. */
  readonly toolCalls: number;
  readonly maxToolCalls: number;
  readonly tainted: boolean;
  readonly expiresAt: Date;
}

/**
 * Consome uma chamada de ferramenta do turno, atomicamente. `null` quando QUALQUER condição
 * falha (turno inexistente, de outro membro, nonce errado, encerrado, expirado ou no teto) — o
 * chamador responde igual em todos os casos (sem oráculo).
 *
 * `clock_timestamp()` e não `now()`: a validade é conferida no instante da chamada, não no
 * início da transação.
 */
async function claimToolCall(
  tx: DbTx,
  input: { turnId: string; memberId: string; nonce: string },
): Promise<ClaimedToolCall | null> {
  const rows = await tx.execute<{
    id: string;
    workspace_id: string;
    member_id: string;
    session_id: string;
    tool_calls: number;
    max_tool_calls: number;
    tainted: boolean;
    expires_at_ms: string;
  }>(sql`
    update copilot_turns
       set tool_calls = tool_calls + 1
     where id = ${input.turnId}::uuid
       and member_id = ${input.memberId}::uuid
       and grant_nonce = ${input.nonce}
       and status = 'running'
       and expires_at > clock_timestamp()
       and tool_calls < max_tool_calls
    returning id, workspace_id, member_id, session_id, tool_calls, max_tool_calls, tainted,
              (extract(epoch from expires_at) * 1000)::bigint::text as expires_at_ms`);
  const row = rows[0];
  if (!row) return null;
  return {
    turnId: row.id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    sessionId: row.session_id,
    toolCalls: Number(row.tool_calls),
    maxToolCalls: Number(row.max_tool_calls),
    tainted: row.tainted,
    expiresAt: new Date(Number(row.expires_at_ms)),
  };
}

/** Marca o turno como contaminado (leu conteúdo de contato). Idempotente; só turno vivo. */
async function markTainted(tx: DbTx, turnId: string): Promise<boolean> {
  const rows = await tx
    .update(copilotTurns)
    .set({ tainted: true })
    .where(and(eq(copilotTurns.id, turnId), eq(copilotTurns.status, 'running')))
    .returning({ id: copilotTurns.id });
  return rows.length > 0;
}

export interface CopilotTurnUsage {
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  /** USD como string decimal (numeric 12,8). */
  costUsd: string;
  iterations: number;
}

function usageSet(usage: CopilotTurnUsage | undefined) {
  if (!usage) return {};
  return {
    ...(usage.model !== undefined ? { model: usage.model } : {}),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd,
    iterations: usage.iterations,
  };
}

/** Encerra com sucesso. `null` se o turno já não estava `running` (encerramento é único). */
async function complete(
  tx: DbTx,
  turnId: string,
  usage: CopilotTurnUsage,
): Promise<CopilotTurnRow | null> {
  const [row] = await tx
    .update(copilotTurns)
    .set({ status: 'completed', completedAt: sql`clock_timestamp()`, ...usageSet(usage) })
    .where(and(eq(copilotTurns.id, turnId), eq(copilotTurns.status, 'running')))
    .returning();
  return row ?? null;
}

/**
 * Encerra sem sucesso (`failed` por padrão; também `cancelled`, `budget_blocked`,
 * `rate_limited`). Uso parcial opcional. `null` se o turno já estava encerrado.
 */
async function fail(
  tx: DbTx,
  turnId: string,
  input: { errorCode: string; status?: CopilotTurnFailureStatus; usage?: CopilotTurnUsage },
): Promise<CopilotTurnRow | null> {
  const [row] = await tx
    .update(copilotTurns)
    .set({
      status: input.status ?? 'failed',
      errorCode: input.errorCode,
      completedAt: sql`clock_timestamp()`,
      ...usageSet(input.usage),
    })
    .where(and(eq(copilotTurns.id, turnId), eq(copilotTurns.status, 'running')))
    .returning();
  return row ?? null;
}

/**
 * Turno `running` mais recente do membro (um turno ativo por vez é regra do S10). Devolve mesmo
 * se já expirou: o chamador decide encerrá-lo (`fail(..., 'timeout')`) antes de abrir outro.
 */
async function findRunningByMember(tx: DbTx, memberId: string): Promise<CopilotTurnRow | null> {
  const [row] = await tx
    .select()
    .from(copilotTurns)
    .where(
      and(
        sql`${copilotTurns.workspaceId} = app_current_workspace()`,
        eq(copilotTurns.memberId, memberId),
        eq(copilotTurns.status, 'running'),
      ),
    )
    .orderBy(desc(copilotTurns.startedAt))
    .limit(1);
  return row ?? null;
}

export const copilotTurnsRepo = {
  createRunning,
  claimToolCall,
  markTainted,
  complete,
  fail,
  findRunningByMember,
} as const;

// ─── Log de chamadas de ferramenta ───────────────────────────────────────────────

export interface InsertCopilotToolCallInput {
  workspaceId: string;
  turnId: string;
  memberId: string;
  toolKey: string;
  decision: CopilotToolCallDecision;
  /** Já redigidos pelo chamador: nada de PII aqui. */
  argsRedacted?: CopilotJsonObject;
  resultMeta?: CopilotJsonObject;
  riskLevel?: CopilotRiskLevel | null;
  errorCode?: string | null;
  durationMs?: number | null;
}

async function insertToolCall(
  tx: DbTx,
  input: InsertCopilotToolCallInput,
): Promise<CopilotToolCallRow> {
  const [row] = await tx
    .insert(copilotToolCalls)
    .values({
      workspaceId: input.workspaceId,
      turnId: input.turnId,
      memberId: input.memberId,
      toolKey: input.toolKey,
      decision: input.decision,
      argsRedacted: input.argsRedacted ?? {},
      resultMeta: input.resultMeta ?? {},
      riskLevel: input.riskLevel ?? null,
      errorCode: input.errorCode ?? null,
      durationMs: input.durationMs ?? null,
    })
    .returning();
  if (!row) throw new Error('copilot: chamada de ferramenta não materializou.');
  return row;
}

export const copilotToolCallsRepo = { insert: insertToolCall } as const;

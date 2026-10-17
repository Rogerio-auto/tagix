/**
 * Briefing do dia por membro (F73-S01; geração na F73-S12).
 *
 * Um por (workspace, membro, data local). Regenerar o mesmo dia atualiza o conteúdo e preserva
 * `seen_at` e `push_sent_at` (o push da manhã sai uma vez só por dia).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbTx } from '../../client';
import {
  copilotBriefings,
  type CopilotBriefingRow,
  type CopilotBriefingStatus,
  type CopilotJsonObject,
} from '../../schema/copilot';

/** `YYYY-MM-DD` (data local do membro). */
export type IsoDate = string;

async function getFor(
  tx: DbTx,
  memberId: string,
  forDate: IsoDate,
): Promise<CopilotBriefingRow | null> {
  const [row] = await tx
    .select()
    .from(copilotBriefings)
    .where(and(eq(copilotBriefings.memberId, memberId), eq(copilotBriefings.forDate, forDate)));
  return row ?? null;
}

async function upsert(
  tx: DbTx,
  input: {
    workspaceId: string;
    memberId: string;
    forDate: IsoDate;
    dataAsOf: Date;
    items: CopilotJsonObject[];
    overflowCount: number;
    status: CopilotBriefingStatus;
  },
): Promise<CopilotBriefingRow> {
  const [row] = await tx
    .insert(copilotBriefings)
    .values({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      forDate: input.forDate,
      dataAsOf: input.dataAsOf,
      items: input.items,
      overflowCount: input.overflowCount,
      status: input.status,
    })
    .onConflictDoUpdate({
      target: [copilotBriefings.workspaceId, copilotBriefings.memberId, copilotBriefings.forDate],
      set: {
        dataAsOf: input.dataAsOf,
        items: input.items,
        overflowCount: input.overflowCount,
        status: input.status,
        generatedAt: sql`now()`,
      },
    })
    .returning();
  if (!row) throw new Error('copilot: briefing não materializou.');
  return row;
}

/** Marca como visto (idempotente: o primeiro instante fica). */
async function markSeen(
  tx: DbTx,
  memberId: string,
  forDate: IsoDate,
): Promise<CopilotBriefingRow | null> {
  const [row] = await tx
    .update(copilotBriefings)
    .set({ seenAt: sql`coalesce(${copilotBriefings.seenAt}, now())` })
    .where(and(eq(copilotBriefings.memberId, memberId), eq(copilotBriefings.forDate, forDate)))
    .returning();
  return row ?? null;
}

/**
 * Reivindica o envio do push: `true` só para quem gravou primeiro (`push_sent_at IS NULL`).
 * Dois agendadores concorrentes nunca mandam o mesmo push duas vezes.
 */
async function markPushSent(tx: DbTx, id: string): Promise<boolean> {
  const rows = await tx
    .update(copilotBriefings)
    .set({ pushSentAt: sql`now()` })
    .where(and(eq(copilotBriefings.id, id), isNull(copilotBriefings.pushSentAt)))
    .returning({ id: copilotBriefings.id });
  return rows.length > 0;
}

export const copilotBriefingsRepo = { getFor, upsert, markSeen, markPushSent } as const;

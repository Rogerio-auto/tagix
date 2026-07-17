/**
 * Porta de retenção contra `@hm/db` (F56-S25, DB-02).
 *
 * `webhook_events` é platform-level (sem `workspace_id` → fora do RLS de tenant),
 * então o sweep roda como owner via `getDb()` — não há escopo de workspace a
 * respeitar. O DELETE é batelado por um subselect com `LIMIT` ordenado por
 * `received_at ASC` (casa com o índice `idx_webhook_events_received`), para nunca
 * varrer/travar a tabela quente inteira num só comando.
 *
 * `.returning({ id })` dá a contagem exata do lote de forma driver-agnóstica
 * (`length`), sem depender do shape de `rowCount`/`count` do postgres.js.
 */
import { asc, inArray, lt } from 'drizzle-orm';
import { getDb, schema } from '@hm/db';
import type { DB } from '@hm/db';
import type { RetentionSweepPort } from './sweep';

const { webhookEvents } = schema;

/**
 * Cria a porta real de sweep. A instância de DB é lazy (default `getDb()`),
 * injetável para testes de integração.
 */
export function createDbSweepPort(db: DB = getDb()): RetentionSweepPort {
  return {
    async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
      // Subselect dos mais antigos abaixo do horizonte (index range scan ASC).
      const oldest = db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(lt(webhookEvents.receivedAt, cutoff))
        .orderBy(asc(webhookEvents.receivedAt))
        .limit(limit);

      const removed = await db
        .delete(webhookEvents)
        .where(inArray(webhookEvents.id, oldest))
        .returning({ id: webhookEvents.id });

      return removed.length;
    },
  };
}

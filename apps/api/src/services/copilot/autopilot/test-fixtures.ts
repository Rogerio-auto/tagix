/**
 * Semeadura dos testes do piloto automático (F73-S13). Só para testes.
 *
 * Reaproveita o mundo do executor de CRM (workspace com um membro por papel, "Paula Gestora" e
 * um segundo atendente, funil com estágios e automações, time privado para o AGENT) e acrescenta
 * sugestões gravadas pelo MESMO repo do gerador. Os negócios nascem com `idleDays >= 1` para que
 * `deals.updated_at` fique SEMPRE antes de `copilot_suggestions.created_at` (o relógio do host e o
 * do container do Postgres divergem; "editado depois da sugestão" só vale quando o teste quer).
 */
import { and, eq } from 'drizzle-orm';
import {
  copilotAutopilotRepo,
  getDb,
  schema,
  withWorkspace,
  type CopilotSuggestionRow,
} from '@hm/db';
import {
  seedCrmWorld,
  seedDeal,
  type CrmWorld,
} from '../../../internal/copilot/act-crm/test-fixtures';
import type { SuggestionsChangedEmitter } from './emit';

export { seedCrmWorld, seedDeal, type CrmWorld };

export interface SeededSuggestion {
  readonly id: string;
  readonly dealId: string;
}

/** Negócio parado (>= 1 dia) + sugestão pendente `from → to`. */
export async function seedSuggestion(
  world: CrmWorld,
  input: {
    readonly title: string;
    readonly from?: string;
    readonly to?: string;
    readonly owner?: string | null;
    readonly conv?: string | null;
    readonly confidence?: 'high' | 'medium' | 'low';
    readonly idleDays?: number;
    readonly status?: CopilotSuggestionRow['status'];
  },
): Promise<SeededSuggestion> {
  const from = input.from ?? world.stage.orcamento;
  const to = input.to ?? world.stage.reativacao;
  const dealId = await seedDeal(world, {
    title: input.title,
    stage: from,
    ...(input.owner !== undefined ? { owner: input.owner } : {}),
    ...(input.conv !== undefined ? { conv: input.conv } : {}),
    idleDays: input.idleDays ?? 9,
  });
  const row = await withWorkspace(world.ws.workspaceId, (tx) =>
    copilotAutopilotRepo.insertSuggestionIfAbsent(tx, {
      workspaceId: world.ws.workspaceId,
      dealId,
      fromStageId: from,
      toStageId: to,
      reasonCode: 'idle_last_outbound',
      reasonText: 'Sem resposta há 9 dias; a última mensagem foi nossa, em 07/10.',
      confidence: input.confidence ?? 'medium',
    }),
  );
  if (!row) throw new Error('seed: sugestão não gravada');
  if (input.status && input.status !== 'pending') {
    await getDb()
      .update(schema.copilotSuggestions)
      .set({
        status: input.status,
        ...(input.status === 'approved' || input.status === 'rejected'
          ? { decidedBy: world.ws.members.OWNER.id, decidedAt: new Date() }
          : {}),
      })
      .where(eq(schema.copilotSuggestions.id, row.id));
  }
  return { id: row.id, dealId };
}

export async function suggestionRow(
  world: CrmWorld,
  id: string,
): Promise<CopilotSuggestionRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(schema.copilotSuggestions)
    .where(
      and(
        eq(schema.copilotSuggestions.id, id),
        eq(schema.copilotSuggestions.workspaceId, world.ws.workspaceId),
      ),
    );
  return row;
}

export async function dealStage(dealId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ stageId: schema.deals.stageId })
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId));
  return row?.stageId;
}

/** Emissor que só guarda o que foi pedido. */
export function captureEmitter(): {
  readonly emit: SuggestionsChangedEmitter;
  readonly calls: Array<{ workspaceId: string; pendingCount: number }>;
} {
  const calls: Array<{ workspaceId: string; pendingCount: number }> = [];
  return {
    calls,
    emit: async ({ workspaceId, payload }) => {
      calls.push({ workspaceId, pendingCount: payload.pending_count });
    },
  };
}

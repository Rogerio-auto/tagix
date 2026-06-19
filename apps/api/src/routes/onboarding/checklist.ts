/**
 * Checklist "Primeiros passos" (ONBOARDING.md §3.3).
 *
 * Status 100% DERIVADO do dado real do workspace — NUNCA flag manual. Cada passo
 * é `done` quando existe pelo menos um recurso no estado-alvo:
 *
 *  - connect_channel  → `channels` ATIVO            (channels.is_active = true)
 *  - activate_agent   → `agents` ATIVO              (agents.status = 'active')
 *  - import_contacts  → ≥1 contato                  (count(contacts) > 0)
 *  - publish_flow     → ≥1 flow PUBLICADO/ATIVO     (flows.status = 'active')
 *  - send_campaign    → ≥1 campanha que JÁ ENVIOU   (campaigns.status in running|completed)
 *
 * As 5 contagens rodam num único round-trip (uma query por tabela) dentro da
 * transação RLS-escopada do workspace, então o filtro de tenant é garantido pela
 * policy (o `count` enxerga só o workspace do `tx`).
 */
import { count, eq, inArray, type SQL } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';

const { channels, agents, contacts, flows, campaigns } = schema;

/** Chaves estáveis dos passos (contrato com a UI / F43-S06). */
export type ChecklistStepKey =
  | 'connect_channel'
  | 'activate_agent'
  | 'import_contacts'
  | 'publish_flow'
  | 'send_campaign';

export interface ChecklistStep {
  key: ChecklistStepKey;
  label: string;
  done: boolean;
  href: string;
}

interface StepDef {
  key: ChecklistStepKey;
  label: string;
  href: string;
}

/** Metadados estáticos de cada passo (rótulo pt-BR + destino na UI). */
const STEP_DEFS: readonly StepDef[] = [
  { key: 'connect_channel', label: 'Conectar o WhatsApp', href: '/settings/channels' },
  { key: 'activate_agent', label: 'Ativar seu agente de IA', href: '/agents' },
  { key: 'import_contacts', label: 'Importar contatos', href: '/contacts' },
  { key: 'publish_flow', label: 'Publicar seu primeiro fluxo', href: '/flows' },
  { key: 'send_campaign', label: 'Enviar a primeira campanha', href: '/campaigns' },
];

/** Campanhas que já saíram do rascunho/agendamento contam como "enviada". */
const CAMPAIGN_SENT_STATUSES = ['running', 'completed'] as const;

/**
 * Deriva o checklist a partir do dado real. Recebe o `DbTx` JÁ escopado
 * (`req.scoped`) — cada count vê apenas o workspace corrente via RLS.
 */
export async function deriveChecklist(tx: DbTx): Promise<ChecklistStep[]> {
  const exists = async (
    table: typeof channels | typeof agents | typeof contacts | typeof flows | typeof campaigns,
    where?: SQL,
  ): Promise<boolean> => {
    const [row] = await tx
      .select({ n: count() })
      .from(table)
      .where(where)
      .limit(1);
    return (row?.n ?? 0) > 0;
  };

  const [channelDone, agentDone, contactDone, flowDone, campaignDone] = await Promise.all([
    exists(channels, eq(channels.isActive, true)),
    exists(agents, eq(agents.status, 'active')),
    exists(contacts, undefined),
    exists(flows, eq(flows.status, 'active')),
    exists(campaigns, inArray(campaigns.status, [...CAMPAIGN_SENT_STATUSES])),
  ]);

  const doneByKey: Record<ChecklistStepKey, boolean> = {
    connect_channel: channelDone,
    activate_agent: agentDone,
    import_contacts: contactDone,
    publish_flow: flowDone,
    send_campaign: campaignDone,
  };

  return STEP_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    href: def.href,
    done: doneByKey[def.key],
  }));
}

/**
 * Emissão do evento `dashboard:metric_changed` (DASHBOARD.md §5/§8).
 *
 * Espelha o transporte de `deal-events.ts`: publica na fila de relay
 * `hm.q.socket.relay`; o relay (apps/api/src/socket/relay.ts) reemite via Socket.io
 * para a room `ws:{id}` (validando o nome do evento contra `SERVER_TO_CLIENT_EVENTS`).
 * Best-effort: falha de broker não derruba a operação que disparou a mudança.
 *
 * A filtragem por role é **server-side por construção**: só emitimos métricas de
 * estado operacional (cadência socket) e o client reage apenas se a métrica está no
 * seu conjunto (DASHBOARD §8). O payload nunca carrega dado de outro role.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { DashboardMetricChangedPayload } from '@hm/shared';

const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

let handlePromise: Promise<MqHandle> | null = null;
async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  return handlePromise;
}

/** Override de teste p/ injetar um publisher fake (sem broker). */
export interface DashboardEventPublisher {
  publish(workspaceId: string, payload: DashboardMetricChangedPayload): Promise<void>;
}

let publisher: DashboardEventPublisher | null = null;
export function setDashboardEventPublisher(p: DashboardEventPublisher | null): void {
  publisher = p;
}

export async function emitDashboardMetricChanged(
  payload: DashboardMetricChangedPayload,
): Promise<void> {
  if (publisher) {
    await publisher.publish(payload.workspaceId, payload);
    return;
  }
  try {
    const { channel } = await getMqHandle();
    const envelope = makeEnvelope('socket.relay', payload.workspaceId, {
      event: 'dashboard:metric_changed',
      target: { workspace: true },
      data: payload,
    });
    channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  } catch {
    // Best-effort: socket é side-effect; o estado já foi persistido.
  }
  await Promise.resolve();
}

// ── Conveniência: lotes de mudança por evento de domínio (F55-S08) ────────────
//
// Os callers de mutação (resolve/close de conversa, conversão registrada) não
// devem conhecer o catálogo de métricas afetadas nem o transporte. Expomos
// helpers de domínio que traduzem "o que aconteceu" → "quais métricas o front
// invalida". O front só usa `metricKey` para decidir o refetch (escopo é hint);
// por isso emitimos um conjunto representativo das chaves visíveis ao role.

/** Uma mudança de métrica a ser emitida (escopo/valor opcionais). */
export interface MetricChange {
  readonly metricKey: string;
  readonly scope?: Record<string, string>;
  readonly newValue?: Record<string, unknown>;
}

/**
 * Emite um lote de mudanças best-effort. **Nunca rejeita**: cada emit é isolado
 * em `allSettled`, então broker fora do ar (ou publisher de teste que lança) não
 * propaga erro. Seguro para `void emit...(...)` no caller (fire-and-forget) —
 * a transação de negócio já está persistida e não pode ser derrubada por isto.
 */
export async function emitDashboardMetricsChanged(
  workspaceId: string,
  changes: readonly MetricChange[],
): Promise<void> {
  await Promise.allSettled(
    changes.map((c) =>
      emitDashboardMetricChanged({
        workspaceId,
        metricKey: c.metricKey,
        scope: c.scope ?? {},
        newValue: c.newValue ?? {},
      }),
    ),
  );
}

/**
 * Métricas invalidadas quando uma conversa entra em estado terminal
 * (resolvida/fechada): SLA do dia, fila de atribuição, agregados de
 * produtividade e o estado de IA. `memberId` (quem resolveu, se humano) habilita
 * os recortes pessoais (`scope: { memberId }`).
 */
export function emitConversationResolvedMetrics(args: {
  readonly workspaceId: string;
  readonly memberId?: string | null;
}): Promise<void> {
  const memberId = args.memberId ?? null;
  const changes: MetricChange[] = [
    { metricKey: 'sla_violado_hoje' },
    { metricKey: 'aguardando_atribuicao' },
    { metricKey: 'em_atendimento_ia' },
    { metricKey: 'leaderboard_produtividade' },
    { metricKey: 'performance_por_atendente' },
  ];
  if (memberId) {
    const scope = { memberId };
    changes.push(
      { metricKey: 'resolvidas_hoje_por_mim', scope },
      { metricKey: 'minha_fila_pendente', scope },
      { metricKey: 'minhas_conversas_abertas', scope },
    );
  }
  return emitDashboardMetricsChanged(args.workspaceId, changes);
}

/**
 * Métricas invalidadas quando uma conversão é registrada: contagem/valor do
 * workspace, placar IA×humano, ROI e os recortes por agente/atendente.
 * `memberId` (quem registrou, se humano) habilita o recorte pessoal.
 */
export function emitConversionRegisteredMetrics(args: {
  readonly workspaceId: string;
  readonly memberId?: string | null;
}): Promise<void> {
  const memberId = args.memberId ?? null;
  const changes: MetricChange[] = [
    { metricKey: 'conversoes_workspace_mes' },
    { metricKey: 'valor_convertido_workspace_mes' },
    { metricKey: 'conversoes_por_tipo' },
    { metricKey: 'placar_ia_humano' },
    { metricKey: 'roi_ia' },
    { metricKey: 'conversoes_por_agente_ia' },
    { metricKey: 'conversoes_por_atendente_humano' },
  ];
  if (memberId) {
    changes.push({ metricKey: 'conversoes_minhas_mes', scope: { memberId } });
  }
  return emitDashboardMetricsChanged(args.workspaceId, changes);
}

export { SOCKET_RELAY_QUEUE };

/**
 * F55-S08 — helpers de domínio do `dashboard:metric_changed`. Sem DB/broker:
 * injeta um `DashboardEventPublisher` de teste e verifica
 *  (1) o catálogo de `metricKey`/`scope` emitido por cada evento de mutação;
 *  (2) best-effort de verdade — um publisher que LANÇA não propaga erro ao
 *      caller (a transação de negócio nunca pode ser derrubada pelo socket).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardMetricChangedPayload } from '@hm/shared';
import {
  emitConversationResolvedMetrics,
  emitConversionRegisteredMetrics,
  setDashboardEventPublisher,
  type DashboardEventPublisher,
} from '../emit';

interface RecordedCall {
  readonly workspaceId: string;
  readonly payload: DashboardMetricChangedPayload;
}

function recordingPublisher(): { publisher: DashboardEventPublisher; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const publisher: DashboardEventPublisher = {
    publish: async (workspaceId, payload) => {
      calls.push({ workspaceId, payload });
      await Promise.resolve();
    },
  };
  return { publisher, calls };
}

/** Publisher que sempre lança — simula broker fora do ar. */
const throwingPublisher: DashboardEventPublisher = {
  publish: async () => {
    await Promise.resolve();
    throw new Error('broker indisponível');
  },
};

afterEach(() => {
  setDashboardEventPublisher(null);
});

const WS = '00000000-0000-0000-0000-000000000001';
const MEMBER = '00000000-0000-0000-0000-000000000002';

function keysOf(calls: readonly RecordedCall[]): string[] {
  return calls.map((c) => c.payload.metricKey);
}

function scopeOf(calls: readonly RecordedCall[], metricKey: string): Record<string, string> | undefined {
  return calls.find((c) => c.payload.metricKey === metricKey)?.payload.scope;
}

describe('emitConversationResolvedMetrics', () => {
  it('emite as métricas de SLA/produtividade no escopo do workspace', async () => {
    const { publisher, calls } = recordingPublisher();
    setDashboardEventPublisher(publisher);

    await emitConversationResolvedMetrics({ workspaceId: WS });

    expect(calls.every((c) => c.workspaceId === WS)).toBe(true);
    expect(keysOf(calls)).toEqual(
      expect.arrayContaining([
        'sla_violado_hoje',
        'aguardando_atribuicao',
        'em_atendimento_ia',
        'leaderboard_produtividade',
        'performance_por_atendente',
      ]),
    );
    // Sem memberId → nenhum recorte pessoal.
    expect(keysOf(calls)).not.toContain('resolvidas_hoje_por_mim');
    // Workspace-level → scope vazio.
    expect(scopeOf(calls, 'sla_violado_hoje')).toEqual({});
  });

  it('adiciona os recortes pessoais com scope { memberId } quando há autor humano', async () => {
    const { publisher, calls } = recordingPublisher();
    setDashboardEventPublisher(publisher);

    await emitConversationResolvedMetrics({ workspaceId: WS, memberId: MEMBER });

    expect(keysOf(calls)).toEqual(
      expect.arrayContaining([
        'resolvidas_hoje_por_mim',
        'minha_fila_pendente',
        'minhas_conversas_abertas',
      ]),
    );
    expect(scopeOf(calls, 'resolvidas_hoje_por_mim')).toEqual({ memberId: MEMBER });
  });
});

describe('emitConversionRegisteredMetrics', () => {
  it('emite conversões/receita/placar do workspace', async () => {
    const { publisher, calls } = recordingPublisher();
    setDashboardEventPublisher(publisher);

    await emitConversionRegisteredMetrics({ workspaceId: WS });

    expect(keysOf(calls)).toEqual(
      expect.arrayContaining([
        'conversoes_workspace_mes',
        'valor_convertido_workspace_mes',
        'conversoes_por_tipo',
        'placar_ia_humano',
        'roi_ia',
        'conversoes_por_agente_ia',
        'conversoes_por_atendente_humano',
      ]),
    );
    expect(keysOf(calls)).not.toContain('conversoes_minhas_mes');
  });

  it('inclui o recorte pessoal quem registrou é humano', async () => {
    const { publisher, calls } = recordingPublisher();
    setDashboardEventPublisher(publisher);

    await emitConversionRegisteredMetrics({ workspaceId: WS, memberId: MEMBER });

    expect(keysOf(calls)).toContain('conversoes_minhas_mes');
    expect(scopeOf(calls, 'conversoes_minhas_mes')).toEqual({ memberId: MEMBER });
  });
});

describe('best-effort', () => {
  it('não propaga erro quando o publisher lança (mutação nunca é derrubada)', async () => {
    setDashboardEventPublisher(throwingPublisher);

    // Resolve sem rejeitar, mesmo com TODOS os emits falhando.
    await expect(
      emitConversationResolvedMetrics({ workspaceId: WS, memberId: MEMBER }),
    ).resolves.toBeUndefined();
    await expect(
      emitConversionRegisteredMetrics({ workspaceId: WS, memberId: MEMBER }),
    ).resolves.toBeUndefined();
  });
});

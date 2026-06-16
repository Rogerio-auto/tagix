'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ChannelProvider } from '@hm/shared';
import { useAgents } from '@/features/agents/queries';
import { useChannels } from '@/features/channels/queries';
import { useConversionTypes } from '@/features/conversions/queries';
import { pipelineKeys, usePipelines } from '@/features/pipeline/board/queries';
import type { Pipeline, Stage } from '@/features/pipeline/board/types';
import type { CustomFieldType } from '@/features/pipeline/custom-fields/types';
import { useTags } from '@/features/settings/sections/workspace-data/queries';
import { useMembers } from '@/features/settings/sections/workspace-org/queries';
import { api } from '@/shared/lib/api-client';

/**
 * Recursos auxiliares do editor de flows, consumidos pelos pickers do inspector
 * (F31-S03). Em vez de pedir IDs crus, os inspectors (S04–S08) leem listas
 * legíveis daqui e escolhem por nome. Os domínios espelham as features de
 * origem — esta camada apenas normaliza para `{ id, name, ...campos úteis }`.
 */

export interface HelperAgent {
  id: string;
  name: string;
  status: string;
}

export interface HelperChannel {
  id: string;
  name: string;
  provider: ChannelProvider;
  isActive: boolean;
}

export interface HelperTag {
  id: string;
  name: string;
  color: string;
}

export interface HelperStage {
  id: string;
  name: string;
  pipelineId: string;
  color: string;
}

export interface HelperPipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: HelperStage[];
}

export interface HelperConversionType {
  id: string;
  name: string;
  key: string;
  color: string;
}

export interface HelperCustomField {
  key: string;
  name: string;
  type: CustomFieldType;
  pipelineId: string;
}

export interface HelperMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface HelperMetaFlow {
  id: string;
  name: string;
}

export interface FlowHelpers {
  agents: HelperAgent[];
  channels: HelperChannel[];
  tags: HelperTag[];
  /** Stages achatados de todos os pipelines (para pickers sem pipeline fixo). */
  stages: HelperStage[];
  pipelines: HelperPipeline[];
  conversionTypes: HelperConversionType[];
  customFields: HelperCustomField[];
  members: HelperMember[];
  /** Meta Flows (WhatsApp) — sem endpoint de listagem hoje; o picker permite valor livre. */
  metaFlows: HelperMetaFlow[];
  /** True enquanto qualquer fonte ainda carrega — os pickers mostram estado de carregamento. */
  isLoading: boolean;
}

const EMPTY: FlowHelpers = {
  agents: [],
  channels: [],
  tags: [],
  stages: [],
  pipelines: [],
  conversionTypes: [],
  customFields: [],
  members: [],
  metaFlows: [],
  isLoading: false,
};

const HelpersContext = createContext<FlowHelpers>(EMPTY);

/**
 * Provider explícito (value-prop). Útil para testes/Ladle ou para reaproveitar
 * dados já carregados. Em produção, prefira o {@link FlowHelpersAutoProvider}.
 */
export function FlowHelpersProvider({ value, children }: { value: FlowHelpers; children: ReactNode }) {
  return <HelpersContext.Provider value={value}>{children}</HelpersContext.Provider>;
}

/** Type guard para entradas de `pipelines.settings.custom_fields[]` (jsonb genérico). */
function parseCustomFields(pipelineId: string, settings: Pipeline['settings']): HelperCustomField[] {
  const raw = settings.custom_fields;
  if (!Array.isArray(raw)) return [];
  const out: HelperCustomField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec['key'] === 'string' ? rec['key'] : undefined;
    if (!key) continue;
    const label = typeof rec['label'] === 'string' ? rec['label'] : key;
    const type = typeof rec['type'] === 'string' ? (rec['type'] as CustomFieldType) : 'text';
    out.push({ key, name: label, type, pipelineId });
  }
  return out;
}

/**
 * Provider self-fetching: chama os query hooks das features de origem e popula
 * o contexto. Os pickers só precisam de `useFlowHelpers()`. Degrada graciosamente
 * — cada fonte ausente vira lista vazia, nunca quebra o editor.
 *
 * SEAM: monte este provider ao redor do editor (FlowEditorPage / InspectorPanel)
 * para que os pickers recebam dados. Sem ele, `useFlowHelpers()` devolve `EMPTY`.
 */
export function FlowHelpersAutoProvider({ children }: { children: ReactNode }) {
  const agentsQ = useAgents();
  const channelsQ = useChannels();
  const tagsQ = useTags();
  const conversionsQ = useConversionTypes();
  const membersQ = useMembers();
  const pipelinesQ = usePipelines();

  const pipelineRows = pipelinesQ.data?.data ?? [];

  // Stages vivem no detalhe de cada pipeline (a lista não os traz). Buscamos em
  // paralelo e com cache compartilhado pela mesma chave do board.
  const stageQueries = useQueries({
    queries: pipelineRows.map((p) => ({
      queryKey: pipelineKeys.detail(p.id),
      queryFn: () => api.get<{ pipeline: Pipeline; stages: Stage[] }>(`/api/pipelines/${p.id}`),
    })),
  });

  const value = useMemo<FlowHelpers>(() => {
    const agents: HelperAgent[] = (agentsQ.data?.agents ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
    }));

    const channels: HelperChannel[] = (channelsQ.data?.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      isActive: c.isActive,
    }));

    const tags: HelperTag[] = (tagsQ.data?.tags ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
    }));

    const conversionTypes: HelperConversionType[] = (conversionsQ.data?.conversionTypes ?? []).map(
      (ct) => ({ id: ct.id, name: ct.label, key: ct.key, color: ct.color }),
    );

    const members: HelperMember[] = (membersQ.data?.members ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.email,
      email: m.email,
      role: m.role,
    }));

    const pipelines: HelperPipeline[] = pipelineRows.map((p, i) => {
      const detail = stageQueries[i]?.data;
      const stages: HelperStage[] = (detail?.stages ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        pipelineId: p.id,
        color: s.color,
      }));
      return { id: p.id, name: p.name, isDefault: p.isDefault, stages };
    });

    const stages: HelperStage[] = pipelines.flatMap((p) => p.stages);

    const customFields: HelperCustomField[] = pipelineRows.flatMap((p) =>
      parseCustomFields(p.id, p.settings),
    );

    const isLoading =
      agentsQ.isLoading ||
      channelsQ.isLoading ||
      tagsQ.isLoading ||
      conversionsQ.isLoading ||
      membersQ.isLoading ||
      pipelinesQ.isLoading ||
      stageQueries.some((q) => q.isLoading);

    return {
      agents,
      channels,
      tags,
      stages,
      pipelines,
      conversionTypes,
      customFields,
      members,
      metaFlows: [],
      isLoading,
    };
  }, [
    agentsQ.data,
    agentsQ.isLoading,
    channelsQ.data,
    channelsQ.isLoading,
    tagsQ.data,
    tagsQ.isLoading,
    conversionsQ.data,
    conversionsQ.isLoading,
    membersQ.data,
    membersQ.isLoading,
    pipelinesQ.isLoading,
    pipelineRows,
    stageQueries,
  ]);

  return <HelpersContext.Provider value={value}>{children}</HelpersContext.Provider>;
}

export function useFlowHelpers(): FlowHelpers {
  return useContext(HelpersContext);
}

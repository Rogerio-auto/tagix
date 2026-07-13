'use client';

/**
 * Contadores/alertas por item da sidebar (PERMISSIONS.md §5 — ex.: "Canais [3 ativos,
 * 1 expirando]"). Busca leve, best-effort: cada contador vem de um endpoint de lista
 * já existente; falha/ausência de endpoint degrada para "sem contador" (não quebra o
 * shell). Sub-slots podem estender este mapa quando seus endpoints existirem.
 */
import { useQuery } from '@tanstack/react-query';
import { summarizeChannels } from '@/features/channels/counters';
import type { Channel } from '@/features/channels/types';
import { api } from '@/shared/lib/api-client';
import type { CounterState } from './registry';

/**
 * Mapa sectionId → contador. Apenas seções com endpoint de lista pronto entram aqui;
 * o resto fica sem badge (omissão honesta).
 */
export function useSectionCounters(): Record<string, CounterState | null> {
  // F56-S05 (UX-06): tipado com o `Channel` real da feature — o contador lia um
  // `status` que o payload público nunca teve e mostrava "0 ativos" com o canal no
  // ar. Agora um drift do contrato quebra no typecheck, não em produção.
  const channels = useQuery({
    queryKey: ['settings-counter', 'channels'],
    queryFn: () => api.get<{ channels: Channel[] }>('/api/channels'),
    retry: false,
    staleTime: 60_000,
  });

  const conversionTypes = useQuery({
    queryKey: ['settings-counter', 'conversion-types'],
    queryFn: () => api.get<{ conversionTypes: unknown[] }>('/api/conversion-types'),
    retry: false,
    staleTime: 60_000,
  });

  // F8-S08: contadores de tags + membros (endpoints reais agora existem).
  const tags = useQuery({
    queryKey: ['settings-counter', 'tags'],
    queryFn: () => api.get<{ tags: unknown[] }>('/api/tags'),
    retry: false,
    staleTime: 60_000,
  });

  const members = useQuery({
    queryKey: ['settings-counter', 'members'],
    queryFn: () => api.get<{ members: unknown[] }>('/api/members'),
    retry: false,
    staleTime: 60_000,
  });

  return {
    canais: channels.data ? summarizeChannels(channels.data.channels) : null,
    conversoes: conversionTypes.data
      ? { label: `${conversionTypes.data.conversionTypes.length} tipos` }
      : null,
    tags: tags.data ? { label: `${tags.data.tags.length}` } : null,
    membros: members.data ? { label: `${members.data.members.length}` } : null,
  };
}

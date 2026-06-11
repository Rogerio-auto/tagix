'use client';

/**
 * Contadores/alertas por item da sidebar (PERMISSIONS.md §5 — ex.: "Canais [3 ativos,
 * 1 expirando]"). Busca leve, best-effort: cada contador vem de um endpoint de lista
 * já existente; falha/ausência de endpoint degrada para "sem contador" (não quebra o
 * shell). Sub-slots podem estender este mapa quando seus endpoints existirem.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { CounterState } from './registry';

interface ChannelRow {
  status?: string;
  tokenExpiresAt?: string | null;
}

function channelsCounter(rows: ChannelRow[]): CounterState | null {
  if (rows.length === 0) return null;
  const active = rows.filter((c) => c.status === 'active' || c.status === 'connected').length;
  const expiring = rows.filter((c) => {
    if (!c.tokenExpiresAt) return false;
    const days = (new Date(c.tokenExpiresAt).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 14;
  }).length;
  const label = expiring > 0 ? `${active} ativos · ${expiring} expirando` : `${active} ativos`;
  return { label, alert: expiring > 0 };
}

/**
 * Mapa sectionId → contador. Apenas seções com endpoint de lista pronto entram aqui;
 * o resto fica sem badge (omissão honesta).
 */
export function useSectionCounters(): Record<string, CounterState | null> {
  const channels = useQuery({
    queryKey: ['settings-counter', 'channels'],
    queryFn: () => api.get<{ channels: ChannelRow[] }>('/api/channels'),
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
    canais: channels.data ? channelsCounter(channels.data.channels) : null,
    conversoes: conversionTypes.data
      ? { label: `${conversionTypes.data.conversionTypes.length} tipos` }
      : null,
    tags: tags.data ? { label: `${tags.data.tags.length}` } : null,
    membros: members.data ? { label: `${members.data.members.length}` } : null,
  };
}

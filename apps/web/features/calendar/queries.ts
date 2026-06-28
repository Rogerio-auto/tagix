'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  CalendarMember,
  CalendarRow,
  CreateEventInput,
  EventContactSummary,
  EventParticipantRow,
  EventRow,
  UpdateEventInput,
} from './types';

export const calendarKeys = {
  calendars: ['calendars'] as const,
  events: (filters: string) => ['events', filters] as const,
  event: (id: string) => ['event', id] as const,
  members: ['calendar', 'members'] as const,
};

export function useCalendars() {
  return useQuery({
    queryKey: calendarKeys.calendars,
    queryFn: () => api.get<{ calendars: CalendarRow[] }>('/api/calendars'),
  });
}

/** Membros do workspace para o seletor de participantes (form 2.0). */
export function useCalendarMembers() {
  return useQuery({
    queryKey: calendarKeys.members,
    queryFn: () => api.get<{ members: CalendarMember[] }>('/api/members'),
  });
}

export interface UseEventsParams {
  /** Overlay multi-calendário — apenas os calendários SELECIONADOS e acessíveis. */
  calendarIds?: readonly string[];
  /** Janela visível (ISO). Necessária para a API expandir recorrências. */
  from?: string;
  to?: string;
  contactId?: string;
}

/**
 * Lista eventos dos calendários selecionados na janela [from, to]. A API escopa por
 * `canAccessCalendar` (interseção com o pedido) e expande recorrências em ocorrências
 * com id sintético `evt:<id>:<startISO>`. Sem `calendarIds` selecionados → sem eventos.
 */
export function useEvents(params: UseEventsParams) {
  const ids = useMemo(() => [...(params.calendarIds ?? [])].sort(), [params.calendarIds]);
  const qs = new URLSearchParams();
  if (ids.length > 0) qs.set('calendarIds', ids.join(','));
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.contactId) qs.set('contact', params.contactId);
  const query = qs.toString();
  return useQuery({
    queryKey: calendarKeys.events(query),
    // Sem calendário selecionado não há o que buscar (evita varrer todos os acessíveis).
    enabled: ids.length > 0,
    queryFn: () => api.get<{ events: EventRow[] }>(`/api/events${query ? `?${query}` : ''}`),
  });
}

export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: calendarKeys.event(id ?? ''),
    enabled: Boolean(id),
    queryFn: () =>
      // F54-S01: o detalhe passa a incluir o resumo do contato vinculado (ou null).
      api.get<{
        event: EventRow;
        participants: EventParticipantRow[];
        contact: EventContactSummary | null;
      }>(`/api/events/${id}`),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation<{ event: EventRow }, Error, CreateEventInput>({
    mutationFn: (input) => api.post<{ event: EventRow }>('/api/events', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation<{ event: EventRow }, Error, { id: string; patch: UpdateEventInput }>({
    mutationFn: ({ id, patch }) => api.put<{ event: EventRow }>(`/api/events/${id}`, patch),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: calendarKeys.event(vars.id) });
    },
  });
}

export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation<{ event: EventRow }, Error, string>({
    mutationFn: (id) => api.post<{ event: EventRow }>(`/api/events/${id}/cancel`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['events'] });
      void qc.invalidateQueries({ queryKey: calendarKeys.event(id) });
    },
  });
}

export interface RsvpInput {
  eventId: string;
  rsvp: 'pending' | 'accepted' | 'declined' | 'tentative';
}

/** RSVP do membro logado em um evento que ele participa. */
export function useRsvpEvent() {
  const qc = useQueryClient();
  return useMutation<{ participant: EventParticipantRow }, Error, RsvpInput>({
    mutationFn: ({ eventId, rsvp }) =>
      api.post<{ participant: EventParticipantRow }>(`/api/events/${eventId}/rsvp`, { rsvp }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: calendarKeys.event(vars.eventId) });
    },
  });
}

// ─── Seleção de calendários (persistida por membro) ───────────────────────────
//
// CONTRATO compartilhado desktop (S03) ↔ mobile (S04): a trilha e a agenda mobile
// consomem o MESMO estado de quais calendários estão visíveis. Persiste em localStorage
// por membro (chave por memberId) para não vazar seleção entre contas no mesmo browser.

const SELECTION_NS = 'hm:calendar:selection';

function selectionKey(memberId: string | undefined): string {
  return `${SELECTION_NS}:${memberId ?? 'anon'}`;
}

function readSelection(memberId: string | undefined): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(selectionKey(memberId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return null;
  }
}

function writeSelection(memberId: string | undefined, ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(selectionKey(memberId), JSON.stringify(ids));
  } catch {
    // Quota/modo privado: degradar para seleção só em memória.
  }
}

export interface CalendarSelection {
  /** Ids selecionados (visíveis no overlay). Subconjunto de `availableIds`. */
  readonly selectedIds: string[];
  /** `true` se o calendário está visível. */
  isSelected: (id: string) => boolean;
  /** Liga/desliga a visibilidade de um calendário. */
  toggle: (id: string) => void;
  /** Define a seleção explícita (ex.: "mostrar só este"). */
  setSelection: (ids: readonly string[]) => void;
  /** Liga todos os disponíveis. */
  selectAll: () => void;
  /** Desliga todos. */
  clear: () => void;
  /** `true` enquanto os calendários ainda não foram carregados (sem default aplicado). */
  readonly isHydrated: boolean;
}

/**
 * Estado de seleção de calendários, persistido por membro. Hook reutilizável pela trilha
 * desktop (S03) e pela agenda mobile (S04). Reconcilia a seleção persistida com os
 * calendários disponíveis (descarta ids que sumiram), e por padrão liga TODOS na primeira
 * visita (sem persistência prévia) — o usuário desliga o que não quer ver.
 */
export function useCalendarSelection(
  availableIds: readonly string[],
  memberId: string | undefined,
): CalendarSelection {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Chave estável da lista de disponíveis (CSV ordenado) — a fonte da verdade do effect,
  // que deriva `availableIds` dela para manter o array de deps honesto (sem disables).
  const availableKey = useMemo(() => [...availableIds].sort().join(','), [availableIds]);

  // Reconcilia ao montar / quando a lista de disponíveis muda (membro provisionado, etc.).
  useEffect(() => {
    const ids = availableKey ? availableKey.split(',') : [];
    if (ids.length === 0) {
      setIsHydrated(false);
      return;
    }
    const available = new Set(ids);
    const persisted = readSelection(memberId);
    let next: string[];
    if (persisted === null) {
      // Primeira visita: liga todos.
      next = ids;
    } else {
      // Mantém só os ainda existentes; se a interseção esvaziar, liga todos (UX > tela vazia).
      const kept = persisted.filter((id) => available.has(id));
      next = kept.length > 0 ? kept : ids;
    }
    setSelectedIds(next);
    setIsHydrated(true);
  }, [availableKey, memberId]);

  const persistAndSet = useCallback(
    (next: string[]) => {
      setSelectedIds(next);
      writeSelection(memberId, next);
    },
    [memberId],
  );

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds]);

  const toggle = useCallback(
    (id: string) => {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
      persistAndSet(next);
    },
    [selectedIds, persistAndSet],
  );

  const setSelection = useCallback(
    (ids: readonly string[]) => persistAndSet([...new Set(ids)]),
    [persistAndSet],
  );

  const selectAll = useCallback(() => persistAndSet([...availableIds]), [availableIds, persistAndSet]);
  const clear = useCallback(() => persistAndSet([]), [persistAndSet]);

  return { selectedIds, isSelected, toggle, setSelection, selectAll, clear, isHydrated };
}

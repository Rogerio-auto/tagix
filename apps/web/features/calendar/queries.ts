'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  CalendarRow,
  CreateEventInput,
  EventParticipantRow,
  EventRow,
  UpdateEventInput,
} from './types';

export const calendarKeys = {
  calendars: ['calendars'] as const,
  events: (filters: string) => ['events', filters] as const,
  event: (id: string) => ['event', id] as const,
};

export function useCalendars() {
  return useQuery({
    queryKey: calendarKeys.calendars,
    queryFn: () => api.get<{ calendars: CalendarRow[] }>('/api/calendars'),
  });
}

/** Lista eventos por filtros (calendar, from, to). */
export function useEvents(params: { calendarId?: string; from?: string; to?: string }) {
  const qs = new URLSearchParams();
  if (params.calendarId) qs.set('calendar', params.calendarId);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  const query = qs.toString();
  return useQuery({
    queryKey: calendarKeys.events(query),
    queryFn: () => api.get<{ events: EventRow[] }>(`/api/events${query ? `?${query}` : ''}`),
  });
}

export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: calendarKeys.event(id ?? ''),
    enabled: Boolean(id),
    queryFn: () =>
      api.get<{ event: EventRow; participants: EventParticipantRow[] }>(`/api/events/${id}`),
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

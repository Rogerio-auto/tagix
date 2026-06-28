'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface MeMember {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  role: string;
  themePreference: 'dark' | 'light' | 'system' | null;
  densityPreference: 'comfortable' | 'compact' | null;
}

export interface MeResponse {
  member: MeMember;
  workspace: { id: string };
}

/**
 * Preferências de som da central de notificações (F53-S06). Fonte da verdade no
 * servidor (persistidas em `notificationPrefs.sound` via `PATCH /api/members/me`).
 */
export interface NotificationSoundPrefs {
  /** Liga/desliga o som dos alertas. */
  enabled: boolean;
  /** Volume normalizado 0–1. */
  volume: number;
  /** Repete o alerta em intervalo até o operador descartar/concluir. */
  repeatUntilConfirmed: boolean;
  /** Apenas visual: mostra a notificação sem tocar áudio. */
  visualOnly: boolean;
}

export interface NotificationPrefs {
  in_app: boolean;
  email: boolean;
  push: boolean;
  sound?: NotificationSoundPrefs;
}

export interface UpdateMeInput {
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  themePreference?: 'dark' | 'light' | 'system';
  densityPreference?: 'comfortable' | 'compact';
  localeOverride?: string | null;
  notificationPrefs?: NotificationPrefs;
}

export interface SessionRow {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string | null;
}

export const meKeys = {
  me: ['me'] as const,
  sessions: ['me', 'sessions'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: meKeys.me,
    queryFn: () => api.get<MeResponse>('/api/me'),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation<{ member: MeMember }, Error, UpdateMeInput>({
    mutationFn: (input) => api.patch<{ member: MeMember }>('/api/members/me', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meKeys.me }),
  });
}

export function useChangePassword() {
  return useMutation<void, Error, { currentPassword: string; newPassword: string }>({
    mutationFn: (input) => api.post<void>('/api/members/me/password', input),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: meKeys.sessions,
    queryFn: () => api.get<{ sessions: SessionRow[] }>('/api/members/me/sessions'),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/members/me/sessions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: meKeys.sessions }),
  });
}

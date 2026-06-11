'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  settings: Record<string, unknown>;
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  isActive: string;
}

export interface TeamMemberRow {
  teamId: string;
  memberId: string;
  role: 'lead' | 'member';
  name: string | null;
  email: string;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  autoAssignStrategy: 'round_robin' | 'least_busy' | 'manual';
  isActive: string;
  members: TeamMemberRow[];
}

export interface SlaRule {
  id: string;
  scopeType: 'workspace' | 'department' | 'team';
  scopeId: string | null;
  firstResponseSecs: number | null;
  resolutionSecs: number | null;
  isActive: string;
}

export const orgKeys = {
  workspace: ['workspace'] as const,
  members: ['members'] as const,
  departments: ['departments'] as const,
  teams: ['teams'] as const,
  sla: ['sla'] as const,
};

// ─── Workspace ────────────────────────────────────────────────────────────────
export function useWorkspace() {
  return useQuery({
    queryKey: orgKeys.workspace,
    queryFn: () => api.get<{ workspace: Workspace }>('/api/workspace'),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation<{ workspace: Workspace }, Error, Record<string, unknown>>({
    mutationFn: (patch) => api.patch<{ workspace: Workspace }>('/api/workspace', patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.workspace }),
  });
}

// ─── Members ──────────────────────────────────────────────────────────────────
export function useMembers() {
  return useQuery({
    queryKey: orgKeys.members,
    queryFn: () => api.get<{ members: Member[] }>('/api/members'),
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation<{ member: Member }, Error, { email: string; name?: string | null; role: string }>({
    mutationFn: (input) => api.post<{ member: Member }>('/api/members', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.members }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation<{ member: Member }, Error, { id: string; role?: string; status?: string }>({
    mutationFn: ({ id, ...patch }) => api.patch<{ member: Member }>(`/api/members/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.members }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/members/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.members }),
  });
}

// ─── Departments ──────────────────────────────────────────────────────────────
export function useDepartments() {
  return useQuery({
    queryKey: orgKeys.departments,
    queryFn: () => api.get<{ departments: Department[] }>('/api/departments'),
  });
}

export function useCreateDepartment() {
  const qc = useQueryClient();
  return useMutation<{ department: Department }, Error, { name: string; description?: string | null }>({
    mutationFn: (input) => api.post<{ department: Department }>('/api/departments', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.departments }),
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/departments/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.departments }),
  });
}

// ─── Teams ────────────────────────────────────────────────────────────────────
export function useTeams() {
  return useQuery({
    queryKey: orgKeys.teams,
    queryFn: () => api.get<{ teams: Team[] }>('/api/teams'),
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation<
    { team: Team },
    Error,
    { name: string; description?: string | null; departmentId?: string | null }
  >({
    mutationFn: (input) => api.post<{ team: Team }>('/api/teams', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.teams }),
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation<{ team: Team }, Error, { id: string; autoAssignStrategy?: string }>({
    mutationFn: ({ id, ...patch }) => api.patch<{ team: Team }>(`/api/teams/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.teams }),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/teams/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.teams }),
  });
}

export function useSetTeamMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, { teamId: string; memberId: string; role?: 'lead' | 'member' }>({
    mutationFn: ({ teamId, memberId, role }) =>
      api.put<void>(`/api/teams/${teamId}/members/${memberId}`, { role: role ?? 'member' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.teams }),
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation<void, Error, { teamId: string; memberId: string }>({
    mutationFn: ({ teamId, memberId }) =>
      api.delete<void>(`/api/teams/${teamId}/members/${memberId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.teams }),
  });
}

// ─── SLA ──────────────────────────────────────────────────────────────────────
export function useSlaRules() {
  return useQuery({
    queryKey: orgKeys.sla,
    queryFn: () => api.get<{ rules: SlaRule[] }>('/api/sla'),
  });
}

export function useUpsertSla() {
  const qc = useQueryClient();
  return useMutation<
    { rule: SlaRule },
    Error,
    { scopeType: string; scopeId?: string | null; firstResponseSecs?: number | null; resolutionSecs?: number | null }
  >({
    mutationFn: (input) => api.put<{ rule: SlaRule }>('/api/sla', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKeys.sla }),
  });
}

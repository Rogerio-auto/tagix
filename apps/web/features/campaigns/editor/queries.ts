'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface SendWindowSlot {
  day: number;
  start: string;
  end: string;
}
export interface SendWindowsConfig {
  enabled: boolean;
  timezone?: string;
  windows?: SendWindowSlot[];
}

export interface CreateCampaignInput {
  channelId: string;
  name: string;
  type: 'broadcast' | 'drip' | 'triggered';
  sendWindows?: SendWindowsConfig;
  rateLimitPerMinute?: number;
  autoHandoffOnReply?: boolean;
  aiHandoffAgentId?: string | null;
}

export interface CampaignStepInput {
  position: number;
  templateName: string;
  languageCode?: string;
  delaySeconds?: number;
  stopOnReply?: boolean;
}

export interface ValidationResult {
  safe: boolean;
  criticalIssues: string[];
  warnings: string[];
  stats: {
    steps: number;
    recipients: number;
    recipientsWithoutOptIn: number;
    qualityRating: string;
    tierLimit: number;
  };
}

export interface BulkRecipientsResult {
  total: number;
  recipientsAdded: number;
  contactsCreated: number;
  contactsReused: number;
  invalid: number;
  report: Array<{ phone: string; status: string; reason?: string }>;
}

export function useCreateCampaign() {
  return useMutation<{ campaign: { id: string } }, Error, CreateCampaignInput>({
    mutationFn: (input) => api.post<{ campaign: { id: string } }>('/api/campaigns', input),
  });
}

export function useUpdateCampaign(id: string) {
  return useMutation<{ campaign: { id: string } }, Error, Partial<CreateCampaignInput>>({
    mutationFn: (input) => api.put<{ campaign: { id: string } }>(`/api/campaigns/${id}`, input),
  });
}

export function useSetSteps(id: string) {
  return useMutation<{ steps: unknown[] }, Error, CampaignStepInput[]>({
    mutationFn: (steps) => api.put<{ steps: unknown[] }>(`/api/campaigns/${id}/steps`, { steps }),
  });
}

export function useUploadRecipients(id: string) {
  return useMutation<
    BulkRecipientsResult,
    Error,
    { rows: Array<{ phone: string; name?: string }>; source?: string; optInOnImport?: boolean }
  >({
    mutationFn: (body) =>
      api.post<BulkRecipientsResult>(`/api/campaigns/${id}/recipients/bulk`, body),
  });
}

export function useValidateCampaign(id: string) {
  return useMutation<ValidationResult, Error, void>({
    mutationFn: () => api.post<ValidationResult>(`/api/campaigns/${id}/validate`),
  });
}

export function useActivateCampaign(id: string) {
  return useMutation<{ campaign: { id: string } }, Error, void>({
    mutationFn: () => api.post<{ campaign: { id: string } }>(`/api/campaigns/${id}/activate`),
  });
}

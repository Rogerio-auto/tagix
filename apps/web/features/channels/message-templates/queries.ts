'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiIssue,
  CreateTemplateInput,
  MessageTemplate,
  MessageTemplateFilters,
  MessageTemplatesResponse,
  TemplateSyncSummary,
} from './types';

export class MessageTemplateApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable?: boolean,
    readonly issues?: ApiIssue[],
    readonly providerAccepted?: boolean,
  ) {
    super(message);
    this.name = 'MessageTemplateApiError';
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let payload: {
      code?: string;
      message?: string;
      retryable?: boolean;
      issues?: ApiIssue[];
      providerAccepted?: boolean;
    } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // A resposta sem JSON ainda recebe uma mensagem acionável abaixo.
    }
    throw new MessageTemplateApiError(
      response.status,
      payload.code ?? 'MESSAGE_TEMPLATE_REQUEST_FAILED',
      payload.message ?? 'Não foi possível concluir a ação. Tente novamente.',
      payload.retryable,
      payload.issues,
      payload.providerAccepted,
    );
  }
  return (await response.json()) as T;
}

export function messageTemplatesKey(channelId: string): readonly ['message-templates', string] {
  return ['message-templates', channelId] as const;
}

export function templatesPath(channelId: string, filters: MessageTemplateFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.language) params.set('language', filters.language);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  params.set('page', String(filters.page));
  params.set('limit', String(filters.limit));
  return `/api/channels/${encodeURIComponent(channelId)}/message-templates?${params.toString()}`;
}

export function useMessageTemplates(channelId: string, filters: MessageTemplateFilters, enabled: boolean) {
  return useQuery({
    queryKey: [...messageTemplatesKey(channelId), filters],
    queryFn: () => request<MessageTemplatesResponse>('GET', templatesPath(channelId, filters)),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useSyncMessageTemplates(channelId: string) {
  const client = useQueryClient();
  return useMutation<{ summary: TemplateSyncSummary }, Error>({
    mutationFn: () => request('POST', `/api/channels/${encodeURIComponent(channelId)}/message-templates/sync`),
    onSuccess: () => client.invalidateQueries({ queryKey: messageTemplatesKey(channelId) }),
  });
}

export function useCreateMessageTemplate(channelId: string) {
  const client = useQueryClient();
  return useMutation<{ template: MessageTemplate }, Error, CreateTemplateInput>({
    mutationFn: (input) => request('POST', `/api/channels/${encodeURIComponent(channelId)}/message-templates`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: messageTemplatesKey(channelId) }),
  });
}

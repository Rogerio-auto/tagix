export type MessageTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'UNKNOWN';

export type MessageTemplateStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'PENDING_DELETION'
  | 'UNKNOWN';

export interface MessageTemplate {
  id: string;
  channelId: string;
  externalId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  rejectionReason: string | null;
  isAvailable: boolean;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface MessageTemplateSyncState {
  syncStatus: string;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  lastItemCount: number | null;
}

export interface MessageTemplatesResponse {
  templates: MessageTemplate[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  syncState: MessageTemplateSyncState;
}

export interface MessageTemplateFilters {
  status: string;
  category: string;
  language: string;
  search: string;
  page: number;
  limit: number;
}

export interface TemplateSyncSummary {
  created: number;
  updated: number;
  archived: number;
  total: number;
  syncedAt: string;
}

export type TemplateButtonDraft = {
  id: string;
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  value: string;
  example: string;
};

export interface CreateTemplateDraft {
  name: string;
  language: string;
  category: Exclude<MessageTemplateCategory, 'UNKNOWN'>;
  header: string;
  headerExample: string;
  body: string;
  bodyExamples: string[];
  footer: string;
  buttons: TemplateButtonDraft[];
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: Exclude<MessageTemplateCategory, 'UNKNOWN'>;
  components: Record<string, unknown>[];
}

export interface ApiIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

export const EMPTY_DRAFT: CreateTemplateDraft = {
  name: '',
  language: 'pt_BR',
  category: 'MARKETING',
  header: '',
  headerExample: '',
  body: '',
  bodyExamples: [],
  footer: '',
  buttons: [],
};

/** Contrato de `/api/meta/lead-sources` (F69-S03). Espelha `apps/api/src/routes/meta/lead-sources.ts`. */

export interface LeadSourceView {
  id: string;
  pageId: string;
  pageName: string | null;
  status: 'active' | 'inactive';
  subscribedAt: string | null;
  lastReconciledAt: string | null;
}

export interface AvailableLeadPage {
  connectionId: string;
  pageId: string;
  pageName: string | null;
}

export interface RecentLeadView {
  id: string;
  pageId: string;
  status: 'received' | 'processed' | 'failed';
  error: string | null;
  attempts: number;
  conversationId: string | null;
  dealId: string | null;
  createdAt: string;
}

export interface LeadSourcesResponse {
  sources: LeadSourceView[];
  available: AvailableLeadPage[];
  recent: RecentLeadView[];
}

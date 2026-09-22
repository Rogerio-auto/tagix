/** Contrato de `/api/meta/lead-sources` (F69-S03). Espelha `apps/api/src/routes/meta/lead-sources.ts`. */

/**
 * Como o lead desta página chega (F69-S13): `webhook` em segundos, `reconciliation` a cada 15 min
 * enquanto a Meta não libera a permissão que assina a página.
 */
export type LeadDelivery = 'webhook' | 'reconciliation';

export interface LeadSourceView {
  id: string;
  pageId: string;
  pageName: string | null;
  status: 'active' | 'inactive';
  delivery: LeadDelivery;
  /** Por que a página ainda não recebe em segundos. Nulo quando está no webhook. */
  subscribeError: string | null;
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

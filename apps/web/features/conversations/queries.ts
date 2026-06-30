'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  ConversationDeal,
  ConversationDetail,
  ConversationFilters,
  ConversationSummary,
  MessageItem,
} from './types';

function toQuery(filters: ConversationFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useConversations(filters: ConversationFilters = {}) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () =>
      api.get<{ conversations: ConversationSummary[] }>(`/api/conversations${toQuery(filters)}`),
    // Realtime resiliente: o socket é o caminho primário, mas pode cair (reconexão,
    // deploy, rede). Revalidar ao focar a janela + tratar sempre como stale faz a
    // ChatList se curar sozinha — sem depender de hard refresh — se algum
    // `message:new` for perdido durante uma queda do socket.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

/** Chave de cache de uma conversa individual. Fonte única compartilhada pelo cockpit. */
export function conversationDetailKey(conversationId: string) {
  return ['conversation', conversationId, 'detail'] as const;
}

/**
 * Detalhe completo de uma conversa (status, aiMode, assignedTo, departmentId…).
 * Usa GET /api/conversations/:id. Habilitado somente quando conversationId existe.
 * F30-S03: alimenta o cockpit do ContactInfoPanel.
 */
export function useConversationDetail(conversationId: string | undefined) {
  return useQuery({
    queryKey: conversationDetailKey(conversationId ?? ''),
    queryFn: () =>
      api.get<{ conversation: ConversationDetail }>(
        `/api/conversations/${conversationId}`,
      ),
    enabled: Boolean(conversationId),
    staleTime: 10_000,
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    queryFn: () =>
      api.get<{ messages: MessageItem[] }>(`/api/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
    // Mesma resiliência da lista: revalida a thread aberta ao focar a janela
    // (caminho de cura independente do socket).
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

/** Chave de cache das mensagens — única fonte de verdade, compartilhada com `useMessages`. */
export function messagesKey(conversationId: string) {
  return ['conversation', conversationId, 'messages'] as const;
}

/** Payload de envio: texto e/ou mídia já hospedada (mediaUrl assinado). */
export interface SendMessageInput {
  conversationId: string;
  /** Texto da mensagem (legenda quando há mídia). `null` quando só mídia. */
  content: string | null;
  /** `text` por padrão; `image`/`file`/etc. quando há mídia anexada. */
  type: string;
  /** URL pública/assinada da mídia já enviada ao storage (R2). */
  mediaUrl?: string | null;
  /** MIME da mídia (o backend exige junto da mediaUrl p/ o provider). */
  mediaMime?: string | null;
  /**
   * Campos extras de protocolo introduzidos pela expansão outbound do F45-S02
   * (ex.: `location`/`contacts`/`voice`). Opcional e tipado como `unknown` por
   * valor — preenchido por S05/S07 sem exigir nova mutation aqui (F45-S03).
   */
  payload?: Readonly<Record<string, unknown>> | null;
}

interface SendMutationContext {
  previous: { messages: MessageItem[] } | undefined;
  optimisticId: string;
}

/**
 * Envia uma mensagem com UI otimista (UX §2.7 — feedback imediato).
 * Insere a bolha localmente antes da resposta da API e reconcilia com a
 * mensagem real no sucesso; faz rollback no erro. `ApiError` (com `ref`)
 * propaga para o chamador tratar via toast/ErrorState.
 *
 * Contrato backend (pendente, ver F1 API): `POST /api/conversations/:id/messages`
 * com `{ content, type, mediaUrl }` → `{ message: MessageItem }`.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation<{ message: MessageItem }, Error, SendMessageInput, SendMutationContext>({
    mutationFn: ({ conversationId, content, type, mediaUrl, mediaMime, payload }) =>
      api.post<{ message: MessageItem }>(`/api/conversations/${conversationId}/messages`, {
        content,
        type,
        mediaUrl: mediaUrl ?? null,
        mediaMime: mediaMime ?? null,
        ...(payload ?? {}),
      }),

    onMutate: async (input): Promise<SendMutationContext> => {
      const key = messagesKey(input.conversationId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<{ messages: MessageItem[] }>(key);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimistic: MessageItem = {
        id: optimisticId,
        conversationId: input.conversationId,
        direction: 'outbound',
        senderType: 'agent',
        type: input.type,
        content: input.content,
        viewStatus: 'sending',
        mediaUrl: input.mediaUrl ?? null,
        createdAt: new Date().toISOString(),
      };

      // A API ordena por createdAt desc → a mais nova é o primeiro item.
      queryClient.setQueryData<{ messages: MessageItem[] }>(key, (curr) => ({
        messages: [optimistic, ...(curr?.messages ?? [])],
      }));

      return { previous, optimisticId };
    },

    onError: (_err, input, context) => {
      if (!context) return;
      // Rollback completo ao snapshot anterior.
      queryClient.setQueryData(messagesKey(input.conversationId), context.previous);
    },

    onSuccess: ({ message }, input, context) => {
      // Substitui a bolha otimista pela mensagem real (mantém posição).
      queryClient.setQueryData<{ messages: MessageItem[] }>(
        messagesKey(input.conversationId),
        (curr) => ({
          messages: (curr?.messages ?? []).map((m) =>
            m.id === context?.optimisticId ? message : m,
          ),
        }),
      );
    },

    onSettled: (_data, _err, input) => {
      void queryClient.invalidateQueries({ queryKey: messagesKey(input.conversationId) });
    },
  });
}

// ── Status mutation (F30-S03 / LIVECHAT_OPS §2) ───────────────────────────────

export interface ChangeStatusInput {
  conversationId: string;
  status: 'open' | 'pending' | 'resolved' | 'snoozed';
  snoozedUntil?: string; // ISO date string
}

interface ChangeStatusResult {
  conversationId: string;
  status: string;
  snoozedUntil: string | null;
}

/**
 * Muta o status operacional da conversa (resolver / snooze / reabrir / pendente).
 * POST /api/conversations/:id/status. Invalida o detalhe e a lista.
 * UX §2.7: botão em loading durante a chamada.
 */
export function useChangeStatus() {
  const queryClient = useQueryClient();

  return useMutation<ChangeStatusResult, Error, ChangeStatusInput>({
    mutationFn: ({ conversationId, status, snoozedUntil }) =>
      api.post<ChangeStatusResult>(`/api/conversations/${conversationId}/status`, {
        status,
        ...(snoozedUntil ? { snoozedUntil } : {}),
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ── AI Mode mutation (F30-S03 / LIVECHAT_OPS §2) ─────────────────────────────

import type { AiMode } from '@hm/shared';

export interface ChangeAiModeInput {
  conversationId: string;
  aiMode: AiMode;
}

interface ChangeAiModeResult {
  conversationId: string;
  aiMode: AiMode;
  reason: string | null;
}

/**
 * Liga / desliga / pausa a IA numa conversa (handoff consciente).
 * POST /api/conversations/:id/ai-mode. Invalida o detalhe e a lista.
 * UX §2.7: feedback imediato via loading state no botão.
 */
export function useChangeAiMode() {
  const queryClient = useQueryClient();

  return useMutation<ChangeAiModeResult, Error, ChangeAiModeInput>({
    mutationFn: ({ conversationId, aiMode }) =>
      api.post<ChangeAiModeResult>(`/api/conversations/${conversationId}/ai-mode`, { aiMode }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ── Agente da conversa (F34-S04 / AGENT_DEPARTMENT_ROUTING_PLAN D4) ───────────

/** Candidato a atender a conversa (agente ativo elegível ao departamento). */
export interface AgentCandidate {
  id: string;
  name: string;
}

interface ConversationAgentResult {
  currentAgentId: string | null;
  currentAgentName: string | null;
  candidates: AgentCandidate[];
}

/** Chave de cache do agente atual + candidatos de uma conversa. */
export function conversationAgentKey(conversationId: string) {
  return ['conversation', conversationId, 'agent'] as const;
}

/**
 * Agente de IA atual da conversa + candidatos elegíveis ao(s) departamento(s).
 * GET /api/conversations/:id/agent. Gated por `conversation.assign_agent` no
 * backend; o caller deve habilitar apenas quando o role tiver a permissão.
 */
export function useConversationAgent(conversationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: conversationAgentKey(conversationId ?? ''),
    queryFn: () =>
      api.get<ConversationAgentResult>(`/api/conversations/${conversationId}/agent`),
    enabled: Boolean(conversationId) && enabled,
    staleTime: 30_000,
  });
}

// ── Card/Negócio: itens, produto-picker, criação (F47-S07) ────────────────────
//
// Espinha do valor: a API recompõe `deals.value_cents = Σ(qty × unit_price)` em
// TODA mutação de item e devolve `dealValueCents`. O cliente NUNCA soma como
// verdade (UX §2.7 evita drift) — exibe o `dealValueCents` que a resposta traz e
// invalida o detalhe da conversa para refletir o novo valor read-through.

/** Item (line-item) de um card — espelha `deal_items` (resposta JSON camelCase). */
export interface DealItem {
  id: string;
  workspaceId: string;
  dealId: string;
  productId: string | null;
  nameSnapshot: string;
  qty: number;
  unitPriceCents: number;
  currency: string;
  position: number;
  createdAt: string;
}

/** Produto do catálogo exposto pelo picker (subset consumido pelo cockpit). */
export interface PickerProduct {
  id: string;
  name: string;
  sku: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
}

interface ProductsListResult {
  products: PickerProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Chave de cache dos itens de um card. */
export function dealItemsKey(dealId: string) {
  return ['deal', dealId, 'items'] as const;
}

/**
 * Itens (line-items) do card. GET /api/deals/:id/items (gated `pipeline.view`).
 * Habilitado só quando há deal — sem deal a seção mostra o CTA de criação.
 */
export function useDealItems(dealId: string | null | undefined) {
  return useQuery({
    queryKey: dealItemsKey(dealId ?? ''),
    queryFn: () => api.get<{ items: DealItem[] }>(`/api/deals/${dealId}/items`),
    enabled: Boolean(dealId),
    staleTime: 10_000,
  });
}

/**
 * Busca no catálogo p/ vincular produto a um item (GET /api/products, `product.view`).
 * Só ativos por padrão; `q` filtra por nome/SKU. Habilitado quando o picker abre.
 */
export function useProductPicker(q: string, enabled: boolean) {
  const term = q.trim();
  return useQuery({
    queryKey: ['products', 'picker', term],
    queryFn: () => {
      const params = new URLSearchParams({ active: 'true', pageSize: '20' });
      if (term) params.set('q', term);
      return api.get<ProductsListResult>(`/api/products?${params.toString()}`);
    },
    enabled,
    staleTime: 30_000,
  });
}

export interface CreateConversationDealInput {
  conversationId: string;
  /** Pipeline escolhido no picker do cockpit; ausente → default do backend. */
  pipelineId?: string | null;
  /** Estágio escolhido; ausente → estágio de entrada do pipeline. */
  stageId?: string | null;
}

/** Pipeline (subset p/ o picker de "Criar card"). */
export interface PickerPipeline {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * Lista os pipelines do workspace para o picker de "Criar card" no cockpit.
 * GET /api/pipelines → `{ data }`. Gated por `pipeline.view` no backend.
 */
export function usePipelines(enabled = true) {
  return useQuery({
    queryKey: ['pipelines', 'list'] as const,
    queryFn: async () => {
      const res = await api.get<{ data: PickerPipeline[] }>('/api/pipelines');
      return res.data;
    },
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Cria/auto-cria o card ligado à conversa — IDEMPOTENTE no backend
 * (POST /api/conversations/:id/deal, gated `deal.edit`). Aceita `pipelineId`/
 * `stageId` opcionais (picker). Invalida o detalhe da conversa para o cockpit
 * refletir o `deal` recém-vinculado.
 */
export function useCreateConversationDeal() {
  const queryClient = useQueryClient();
  return useMutation<{ deal: ConversationDeal }, Error, CreateConversationDealInput>({
    mutationFn: ({ conversationId, pipelineId, stageId }) =>
      api.post<{ deal: ConversationDeal }>(`/api/conversations/${conversationId}/deal`, {
        pipelineId: pipelineId ?? null,
        stageId: stageId ?? null,
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
    },
  });
}

/** Corpo do POST de item: produto do catálogo (productId) OU ad-hoc (nome+preço). */
export interface AddDealItemInput {
  dealId: string;
  conversationId: string;
  productId?: string | null;
  nameSnapshot?: string;
  unitPriceCents?: number;
  qty: number;
}

interface MutateItemResult {
  item: DealItem;
  dealValueCents: number;
}

/**
 * Adiciona um item ao card. A resposta traz `dealValueCents` recomputado pelo
 * servidor — invalidamos os itens e o detalhe da conversa (que carrega
 * `deal.valueCents` read-through) para a UI mostrar o valor autoritativo.
 */
export function useAddDealItem() {
  const queryClient = useQueryClient();
  return useMutation<MutateItemResult, Error, AddDealItemInput>({
    mutationFn: ({ dealId, productId, nameSnapshot, unitPriceCents, qty }) =>
      api.post<MutateItemResult>(`/api/deals/${dealId}/items`, {
        ...(productId ? { productId } : {}),
        ...(nameSnapshot !== undefined ? { nameSnapshot } : {}),
        ...(unitPriceCents !== undefined ? { unitPriceCents } : {}),
        qty,
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: dealItemsKey(input.dealId) });
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
    },
  });
}

export interface UpdateDealItemInput {
  dealId: string;
  conversationId: string;
  itemId: string;
  patch: { qty?: number; unitPriceCents?: number; nameSnapshot?: string };
}

/** Edita qty/preço/nome de um item (PATCH /api/deals/:id/items/:itemId). */
export function useUpdateDealItem() {
  const queryClient = useQueryClient();
  return useMutation<MutateItemResult, Error, UpdateDealItemInput>({
    mutationFn: ({ dealId, itemId, patch }) =>
      api.patch<MutateItemResult>(`/api/deals/${dealId}/items/${itemId}`, patch),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: dealItemsKey(input.dealId) });
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
    },
  });
}

export interface RemoveDealItemInput {
  dealId: string;
  conversationId: string;
  itemId: string;
}

/** Remove um item do card (DELETE /api/deals/:id/items/:itemId). */
export function useRemoveDealItem() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true; dealValueCents: number }, Error, RemoveDealItemInput>({
    mutationFn: ({ dealId, itemId }) =>
      api.delete<{ ok: true; dealValueCents: number }>(
        `/api/deals/${dealId}/items/${itemId}`,
      ),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: dealItemsKey(input.dealId) });
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
    },
  });
}

export interface AssignAgentInput {
  conversationId: string;
  agentId: string;
}

interface AssignAgentResult {
  conversationId: string;
  agentId: string;
}

/**
 * Troca o agente de IA que atende a conversa (re-engaja a IA no backend).
 * POST /api/conversations/:id/agent. Invalida o agente, o detalhe e a lista.
 * UX §2.7: o seletor entra em loading durante a mutation.
 */
export function useAssignAgent() {
  const queryClient = useQueryClient();

  return useMutation<AssignAgentResult, Error, AssignAgentInput>({
    mutationFn: ({ conversationId, agentId }) =>
      api.post<AssignAgentResult>(`/api/conversations/${conversationId}/agent`, { agentId }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: conversationAgentKey(input.conversationId) });
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

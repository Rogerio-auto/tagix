'use client';

/**
 * Rede da etapa Mensagem (F58-S09). Fala com o contrato do criador guiado
 * (F58-S06) e, só para explicar por que um modelo saiu do ar, com a Central de
 * modelos (F58-S04/S05).
 *
 * Usa `fetch` próprio em vez de `@/shared/lib/api-client` por dois motivos que o
 * cliente compartilhado não cobre: o teste exige o cabeçalho `Idempotency-Key`, e
 * os erros do criador chegam como `{ code, message }` — o código estável é o que
 * decide a reação da tela (ex.: modelo saiu do ar → reconferir o catálogo).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TemplateBinding, TemplateOption } from './model';

export class BuilderApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BuilderApiError';
  }
}

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? '';

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BuilderApiError(
      0,
      'NETWORK',
      'Sem conexão com o servidor. Confira a internet e tente de novo.',
    );
  }
  if (!response.ok) {
    let payload: { code?: unknown; message?: unknown; error?: unknown } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      // Sem corpo JSON: a mensagem padrão abaixo ainda orienta.
    }
    const code =
      typeof payload.code === 'string'
        ? payload.code
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP_${response.status}`;
    const message =
      typeof payload.message === 'string' && payload.message.length > 0
        ? payload.message
        : fallbackMessage(response.status);
    throw new BuilderApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function fallbackMessage(status: number): string {
  if (status === 403) return 'Seu perfil não tem permissão para esta ação.';
  if (status === 404) return 'Não encontramos o que você pediu neste workspace.';
  if (status === 429) return 'Muitas tentativas seguidas. Aguarde alguns segundos.';
  if (status >= 500) return 'O servidor falhou ao responder. Tente de novo em instantes.';
  return 'Não foi possível concluir a ação. Tente de novo.';
}

/** Código da API para "o modelo deixou de estar aprovado/disponível". */
export const TEMPLATE_NOT_USABLE = 'CAMPAIGN_TEMPLATE_NOT_USABLE';

/* ── Catálogo de modelos aprovados ───────────────────────────────────────── */

export interface BuilderChannel {
  readonly id: string;
  readonly name: string;
  readonly displayHandle: string | null;
  readonly provider: string;
  readonly eligible: boolean;
  readonly ineligibleMessage: string | null;
  readonly capabilities: { readonly testSend: boolean; readonly approvedMessageTemplates: boolean };
  readonly approvedTemplateCount: number;
  readonly lastSyncedAt: string | null;
}

interface OptionsResponse {
  readonly channels: readonly BuilderChannel[];
  readonly templates: readonly TemplateOption[];
  readonly page: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

export interface ApprovedCatalog {
  readonly channel: BuilderChannel | null;
  readonly templates: readonly TemplateOption[];
  /** Passou do teto de páginas: a busca da tela não enxerga tudo. */
  readonly truncated: boolean;
}

const PAGE_SIZE = 100;
/** 1.000 modelos aprovados num número só é patológico; acima disso, avisa. */
const MAX_PAGES = 10;

export const approvedTemplatesKey = (channelId: string) =>
  ['campaign-builder', 'approved-templates', channelId] as const;

/**
 * Todos os modelos aprovados e disponíveis do canal, numa lista só.
 *
 * Por que trazer tudo em vez de buscar no servidor a cada tecla: o filtro fica
 * instantâneo, os filtros de categoria/idioma só oferecem o que existe, e a
 * MESMA lista responde "o modelo escolhido continua aprovado?". Revalida ao
 * voltar para a aba — é assim que um modelo pausado pela Meta enquanto a
 * pessoa estava em outra janela bloqueia o avanço sem recarregar a página.
 */
export function useApprovedTemplates(channelId: string) {
  return useQuery<ApprovedCatalog, BuilderApiError>({
    queryKey: approvedTemplatesKey(channelId),
    enabled: channelId.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const templates: TemplateOption[] = [];
      let channel: BuilderChannel | null = null;
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({ channelId, limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);
        const response: OptionsResponse = await request<OptionsResponse>(
          'GET',
          `/api/campaigns/builder/options?${params.toString()}`,
        );
        channel = response.channels.find((c) => c.id === channelId) ?? channel;
        templates.push(...response.templates.filter((t) => t.channelId === channelId));
        if (!response.page.hasMore || response.page.nextCursor === null) {
          return { channel, templates, truncated: false };
        }
        cursor = response.page.nextCursor;
      }
      return { channel, templates, truncated: true };
    },
  });
}

/* ── Situação atual de um modelo que saiu do catálogo ────────────────────── */

export interface CatalogEntry {
  readonly name: string;
  readonly language: string;
  readonly status: string;
  readonly isAvailable: boolean;
  readonly rejectionReason: string | null;
}

/**
 * Por que o modelo escolhido sumiu (pausado, rejeitado, desativado…). É
 * explicação, não decisão: o bloqueio vem do catálogo de aprovados. Se esta
 * consulta falhar (perfil sem acesso à Central), a tela cai numa frase genérica.
 */
export function useTemplateSituation(
  channelId: string,
  name: string,
  language: string,
  enabled: boolean,
) {
  return useQuery<CatalogEntry | null, BuilderApiError>({
    queryKey: ['campaign-builder', 'template-situation', channelId, name, language],
    enabled: enabled && channelId.length > 0 && name.length > 0,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const params = new URLSearchParams({
        search: name,
        availability: 'all',
        page: '1',
        limit: '25',
      });
      if (language) params.set('language', language);
      const response = await request<{ templates: readonly CatalogEntry[] }>(
        'GET',
        `/api/channels/${encodeURIComponent(channelId)}/message-templates?${params.toString()}`,
      );
      return (
        response.templates.find((t) => t.name === name && (!language || t.language === language)) ??
        null
      );
    },
  });
}

/** Busca os modelos na Meta de novo e reconfere o catálogo de aprovados. */
export function useSyncTemplates(channelId: string) {
  const client = useQueryClient();
  return useMutation<unknown, BuilderApiError>({
    mutationFn: () =>
      request('POST', `/api/channels/${encodeURIComponent(channelId)}/message-templates/sync`),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: approvedTemplatesKey(channelId) });
      void client.invalidateQueries({
        queryKey: ['campaign-builder', 'template-situation', channelId],
      });
      void client.invalidateQueries({ queryKey: ['message-templates', channelId] });
    },
  });
}

/* ── Envio de teste ──────────────────────────────────────────────────────── */

export interface TestSendInput {
  readonly templateId: string;
  readonly to: string;
  readonly bindings: readonly TemplateBinding[];
  /** Mesma chave em retentativas da MESMA intenção: clique duplo não envia dois. */
  readonly idempotencyKey: string;
}

export interface TestSendResult {
  readonly messageId: string;
  readonly queued: boolean;
  readonly replayed: boolean;
}

export function useSendTest(campaignId: string | null, channelId: string) {
  const client = useQueryClient();
  return useMutation<TestSendResult, BuilderApiError, TestSendInput>({
    mutationFn: ({ idempotencyKey, ...body }) => {
      if (campaignId === null) {
        return Promise.reject(
          new BuilderApiError(
            0,
            'CAMPAIGN_NOT_SAVED',
            'Salve a campanha antes de enviar um teste.',
          ),
        );
      }
      return request<TestSendResult>(
        'POST',
        `/api/campaigns/${encodeURIComponent(campaignId)}/builder/test`,
        body,
        { 'Idempotency-Key': idempotencyKey },
      );
    },
    onError: (error) => {
      // O servidor é quem sabe se o modelo saiu do ar: reconfere o catálogo para
      // a tela trocar o erro pontual pelo bloqueio com "escolher outro".
      if (error.code === TEMPLATE_NOT_USABLE) {
        void client.invalidateQueries({ queryKey: approvedTemplatesKey(channelId) });
      }
    },
  });
}

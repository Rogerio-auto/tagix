'use client';

/**
 * Rede da etapa Quando enviar (F58-S10).
 *
 * Uma leitura só: `POST /api/campaigns/:id/builder/estimate` (F58-S06), sem
 * sobreposições, para saber o público elegível já salvo e a saúde do número
 * (qualidade + capacidade diária). A conta de duração NÃO vem daqui: ela roda
 * local a cada mudança (`model.ts → forecastDelivery`), espelhando o worker —
 * a estimativa do servidor conta 1440 min/dia e ignora o corte de ritmo por
 * qualidade, e a tela não pode prometer menos do que o envio faz.
 */
import { useQuery } from '@tanstack/react-query';
import type { ChannelQuality } from './model';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? '';

export class DeliveryApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryApiError';
  }
}

interface EstimateResponse {
  readonly audience: { readonly eligible: number };
  readonly steps: number;
  readonly capacity: {
    readonly quality: string;
    readonly providerDailyLimit: number | null;
    readonly providerCapacityKnown: boolean;
  };
}

export interface DeliveryRemoteContext {
  readonly eligible: number;
  readonly steps: number;
  readonly quality: ChannelQuality;
  readonly providerDailyLimit: number | null;
}

function toQuality(raw: string): ChannelQuality {
  return raw === 'GREEN' || raw === 'YELLOW' || raw === 'RED' ? raw : 'UNKNOWN';
}

function messageFor(status: number): string {
  if (status === 0) return 'Sem conexão com o servidor.';
  if (status === 403) return 'Seu perfil não pode editar esta campanha.';
  if (status === 404) return 'A campanha não foi encontrada neste workspace.';
  if (status === 429) return 'Muitas consultas seguidas.';
  if (status >= 500) return 'O servidor falhou ao responder.';
  return 'Não foi possível ler o público e o número.';
}

async function fetchContext(campaignId: string): Promise<DeliveryRemoteContext> {
  let response: Response;
  try {
    response = await fetch(
      `${BASE_URL}/api/campaigns/${encodeURIComponent(campaignId)}/builder/estimate`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
  } catch {
    throw new DeliveryApiError(0, messageFor(0));
  }
  if (!response.ok) {
    let message = messageFor(response.status);
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string' && body.message.length > 0) message = body.message;
    } catch {
      // sem corpo JSON: fica a mensagem padrão
    }
    throw new DeliveryApiError(response.status, message);
  }
  const body = (await response.json()) as EstimateResponse;
  return {
    eligible: Math.max(0, body.audience.eligible),
    steps: Math.max(0, body.steps),
    quality: toQuality(body.capacity.quality),
    providerDailyLimit: body.capacity.providerCapacityKnown
      ? body.capacity.providerDailyLimit
      : null,
  };
}

export const deliveryContextKey = (campaignId: string) =>
  ['campaign-builder', 'delivery-context', campaignId] as const;

/** Público salvo + saúde do número. Desligado sem rascunho salvo. */
export function useDeliveryContext(campaignId: string | null) {
  return useQuery({
    queryKey: deliveryContextKey(campaignId ?? ''),
    queryFn: () => fetchContext(campaignId ?? ''),
    enabled: campaignId !== null && campaignId.length > 0,
    // A saúde do número é cacheada 60 s no servidor; não adianta perguntar antes.
    staleTime: 60_000,
    retry: (count, error) =>
      count < 2 &&
      !(error instanceof DeliveryApiError && error.status >= 400 && error.status < 500),
  });
}

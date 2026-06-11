/**
 * Helpers de Graph API para campanhas (CAMPAIGNS.md 5).
 *
 * `fetchChannelQuality` le o quality rating (GREEN/YELLOW/RED) + tier limit do
 * phone number WABA; `fetchMetaTemplate` le status (APPROVED/...) + categoria
 * (MARKETING/UTILITY/AUTHENTICATION) de um template pelo nome. Consumidos pela
 * validacao pre-flight (F6-S03) e pelo worker (F6-S05). Sem any: respostas do
 * Graph sao narrowed com type guards.
 *
 * NOTA WABA: o caminho ponta-a-ponta exige uma WABA real conectada (token +
 * phone_number_id + waba_id). No ambiente de dev nao ha WABA -> a logica de
 * parsing/normalizacao e testada com Graph API mockada (GraphClient injetado).
 */

import type { GraphClient } from '../shared/graphClient';

/** Quality rating normalizado do canal (3 estados + UNKNOWN). */
export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

/** Saude do canal usada por validacao + rate adaptativo. */
export interface ChannelHealth {
  readonly qualityRating: QualityRating;
  /** Limite de mensagens/dia do tier atual da conta. */
  readonly tierLimit: number;
  /** String crua do tier Meta (ex.: TIER_1K), quando disponivel. */
  readonly messagingTier?: string;
}

/** Categorias de template Meta. */
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'UNKNOWN';

/** Status de aprovacao de um template Meta. */
export type TemplateStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'NOT_FOUND';

/** Resultado tipado de `fetchMetaTemplate`. */
export interface MetaTemplateInfo {
  readonly name: string;
  readonly status: TemplateStatus;
  readonly category: TemplateCategory;
  readonly language?: string;
}

/** Mapa de tiers Meta -> limite diario de conversas iniciadas pela empresa. */
const TIER_LIMITS: Readonly<Record<string, number>> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: Number.MAX_SAFE_INTEGER,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Normaliza o quality rating cru do Graph para o enum. */
function normalizeQuality(raw: string | undefined): QualityRating {
  switch ((raw ?? '').toUpperCase()) {
    case 'GREEN':
      return 'GREEN';
    case 'YELLOW':
      return 'YELLOW';
    case 'RED':
      return 'RED';
    default:
      return 'UNKNOWN';
  }
}

/** Resolve o limite diario a partir do tier cru (default conservador: 250). */
function tierToLimit(tier: string | undefined): number {
  if (!tier) return 250;
  return TIER_LIMITS[tier.toUpperCase()] ?? 250;
}

/**
 * Le quality rating + tier do phone number da WABA.
 * GET /{phoneNumberId}?fields=quality_rating,messaging_limit_tier
 *
 * Erros de Graph propagam (MetaError) — o caller decide. Resposta sem os campos
 * cai em UNKNOWN / limite conservador (nao bloqueia por dado ausente, mas a
 * validacao trata UNKNOWN como sinal a parte).
 */
export async function fetchChannelQuality(
  graph: GraphClient,
  args: { readonly phoneNumberId: string; readonly accessToken: string },
): Promise<ChannelHealth> {
  const path = '/' + args.phoneNumberId + '?fields=quality_rating,messaging_limit_tier';
  const res = await graph.get(path, args.accessToken);
  if (!isRecord(res)) {
    return { qualityRating: 'UNKNOWN', tierLimit: 250 };
  }
  const tier = asString(res['messaging_limit_tier']);
  return {
    qualityRating: normalizeQuality(asString(res['quality_rating'])),
    tierLimit: tierToLimit(tier),
    messagingTier: tier,
  };
}

/** Narrowing do enum de status do Graph. */
function normalizeStatus(raw: string | undefined): TemplateStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'APPROVED';
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'PENDING';
    case 'REJECTED':
      return 'REJECTED';
    case 'PAUSED':
      return 'PAUSED';
    case 'DISABLED':
      return 'DISABLED';
    default:
      return 'NOT_FOUND';
  }
}

/** Narrowing do enum de categoria do Graph. */
function normalizeCategory(raw: string | undefined): TemplateCategory {
  switch ((raw ?? '').toUpperCase()) {
    case 'MARKETING':
      return 'MARKETING';
    case 'UTILITY':
      return 'UTILITY';
    case 'AUTHENTICATION':
      return 'AUTHENTICATION';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Le status + categoria de um template Meta pelo nome.
 * GET /{wabaId}/message_templates?name=...&language=...
 *
 * Se nao houver match -> status NOT_FOUND, category UNKNOWN (caller trata como
 * nao-aprovado na validacao). Filtra por idioma quando informado.
 */
export async function fetchMetaTemplate(
  graph: GraphClient,
  args: {
    readonly wabaId: string;
    readonly accessToken: string;
    readonly templateName: string;
    readonly languageCode?: string;
  },
): Promise<MetaTemplateInfo> {
  const qs = '?name=' + encodeURIComponent(args.templateName) + '&fields=name,status,category,language';
  const path = '/' + args.wabaId + '/message_templates' + qs;
  const res = await graph.get(path, args.accessToken);

  const notFound: MetaTemplateInfo = {
    name: args.templateName,
    status: 'NOT_FOUND',
    category: 'UNKNOWN',
  };
  if (!isRecord(res)) return notFound;
  const data = res['data'];
  if (!Array.isArray(data) || data.length === 0) return notFound;

  // Match por idioma quando solicitado; senao o primeiro.
  const wanted = args.languageCode?.toLowerCase();
  const match =
    data.find(
      (t) => isRecord(t) && (wanted ? asString(t['language'])?.toLowerCase() === wanted : true),
    ) ?? data[0];
  if (!isRecord(match)) return notFound;

  return {
    name: asString(match['name']) ?? args.templateName,
    status: normalizeStatus(asString(match['status'])),
    category: normalizeCategory(asString(match['category'])),
    language: asString(match['language']),
  };
}

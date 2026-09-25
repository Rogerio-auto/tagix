/**
 * Atribuição de anúncio (F70-S05): o `referral` da Meta normalizado num formato
 * único para WhatsApp e Instagram.
 *
 * Por que existe: o parser WA não lia `messages[].referral` e o `ctwa_clid` (o
 * identificador do clique, sem o qual não se devolve conversão para a Meta) se
 * perdia junto com o payload cru, que só vive 30 dias em `webhook_events`. O IG
 * guardava o `referral` cru em `messages.metadata`, num formato que nenhum
 * consumidor entendia.
 *
 * O módulo mora em `meta/whatsapp/` porque é lá que está o formato mais rico
 * (Click-to-WhatsApp); o IG importa daqui. Quando `meta/` puder receber arquivo,
 * sobe um nível sem mudar a API.
 *
 * Tolerância: o `referral` é payload externo que a Meta muda sem aviso (o
 * `welcome_message` apareceu em 2024, `ctwa_clid` não vem em referral de post
 * orgânico). Cada campo é validado isoladamente; campo ausente ou de tipo errado
 * vira `undefined` e nunca derruba a mensagem. Só se descarta o referral inteiro
 * quando ele não carrega NENHUM dado que identifique a origem.
 *
 * Sem Zod de propósito: `@hm/channels` não depende de `zod` (o parser inteiro usa
 * narrowing por colchetes). A validação aqui é a mesma coisa, campo a campo.
 */

/** Canal onde o clique virou conversa. Espelha `ChannelProvider` do Meta. */
export type AdReferralChannel = 'meta_whatsapp' | 'meta_instagram';

/**
 * Tipo da origem, normalizado em minúsculas.
 *
 * - `ad`: anúncio pago (WA `source_type:"ad"`, IG `source:"ADS"`).
 * - `post`: post orgânico impulsionado/compartilhado (WA `source_type:"post"`).
 * - qualquer outro valor que a Meta mandar chega em minúsculas (ex.: `shortlink`,
 *   `ig_me`), para não perder informação nem inventar categoria.
 */
export type AdReferralSourceType = 'ad' | 'post' | (string & {});

/** Referral normalizado — o contrato que o worker grava em contato/deal. */
export interface AdReferral {
  readonly channel: AdReferralChannel;
  readonly sourceType: AdReferralSourceType;
  /** ID do anúncio (WA `source_id`, IG `ad_id`) ou do post. */
  readonly sourceId?: string;
  readonly sourceUrl?: string;
  readonly headline?: string;
  readonly body?: string;
  /** `image` | `video` (WA). */
  readonly mediaType?: string;
  /** Click ID do Click-to-WhatsApp: chave para a Conversions API (F69-S06). */
  readonly ctwaClid?: string;
  /** `ref` do link (IG/ig.me), quando houver. */
  readonly ref?: string;
  /**
   * URLs de mídia do criativo. Expiram na CDN da Meta: servem para exibir na
   * conversa por alguns dias, NÃO para persistir como dado de atribuição.
   */
  readonly imageUrl?: string;
  readonly videoUrl?: string;
  readonly thumbnailUrl?: string;
  /** Instante do clique/mensagem (ISO-8601) — o `ad_referred_at` persistido. */
  readonly referredAt: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Limite defensivo: headline/body de anúncio são curtos; nada de 1 MB no banco. */
const MAX_FIELD_LEN = 2048;

/** String não vazia (após trim), truncada; qualquer outra coisa → `undefined`. */
function cleanString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t === '') return undefined;
  return t.length > MAX_FIELD_LEN ? t.slice(0, MAX_FIELD_LEN) : t;
}

/**
 * Identificador da Meta (ad id, post id). Aceita inteiro seguro além de string:
 * ids de anúncio têm 18 dígitos e já chegaram como número em integrações de
 * terceiros. Número fora do inteiro seguro perdeu precisão — descarta.
 */
function cleanId(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? String(v) : undefined;
  return cleanString(v);
}

/** URL http(s) válida; qualquer outra coisa (inclusive `javascript:`) → `undefined`. */
function cleanUrl(v: unknown): string | undefined {
  const s = cleanString(v);
  if (s === undefined) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSourceType(raw: string | undefined): AdReferralSourceType | undefined {
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  // IG manda `ADS`; WA manda `ad`. Mesmo significado.
  if (lower === 'ads') return 'ad';
  return lower;
}

/** Remove chaves `undefined` para o objeto ir limpo para `messages.metadata` (jsonb). */
function compact(r: AdReferral): AdReferral {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) out[k] = v;
  return out as unknown as AdReferral;
}

/** O referral só vale se identificar a origem por algum dado concreto. */
function hasIdentifyingData(r: AdReferral): boolean {
  return (
    r.sourceId !== undefined ||
    r.ctwaClid !== undefined ||
    r.sourceUrl !== undefined ||
    r.headline !== undefined ||
    r.ref !== undefined
  );
}

/**
 * Normaliza o `messages[].referral` do webhook WhatsApp Cloud API.
 *
 * Formato (doc "Webhooks > messages > referral", Click-to-WhatsApp):
 * `{ source_url, source_id, source_type: 'ad'|'post', headline, body,
 *    media_type: 'image'|'video', image_url?, video_url?, thumbnail_url?,
 *    ctwa_clid?, welcome_message? }`.
 */
export function parseWhatsAppReferral(raw: unknown, referredAt: string): AdReferral | undefined {
  if (!isRecord(raw)) return undefined;
  const ref = compact({
    channel: 'meta_whatsapp',
    // Sem `source_type` mas com dados: é um clique de anúncio (o único referral
    // que o WA emite sem post). Não inventamos `post`.
    sourceType: normalizeSourceType(cleanString(raw['source_type'])) ?? 'ad',
    sourceId: cleanId(raw['source_id']),
    sourceUrl: cleanUrl(raw['source_url']),
    headline: cleanString(raw['headline']),
    body: cleanString(raw['body']),
    mediaType: cleanString(raw['media_type'])?.toLowerCase(),
    ctwaClid: cleanString(raw['ctwa_clid']),
    imageUrl: cleanUrl(raw['image_url']),
    videoUrl: cleanUrl(raw['video_url']),
    thumbnailUrl: cleanUrl(raw['thumbnail_url']),
    referredAt,
  });
  return hasIdentifyingData(ref) ? ref : undefined;
}

/**
 * Normaliza o `referral` do Instagram Messaging (vem em `messaging[].referral`
 * ou em `messaging[].message.referral` na primeira mensagem vinda do anúncio).
 *
 * Formato: `{ ref?, ad_id?, source: 'ADS'|..., type: 'OPEN_THREAD',
 *   ads_context_data?: { ad_title?, photo_url?, video_url?, post_id?, product_id? } }`.
 */
export function parseInstagramReferral(raw: unknown, referredAt: string): AdReferral | undefined {
  if (!isRecord(raw)) return undefined;
  const ctx = isRecord(raw['ads_context_data']) ? raw['ads_context_data'] : undefined;
  const adId = cleanId(raw['ad_id']);
  const source = normalizeSourceType(cleanString(raw['source']));
  const imageUrl = ctx ? cleanUrl(ctx['photo_url']) : undefined;
  const videoUrl = ctx ? cleanUrl(ctx['video_url']) : undefined;
  const mediaType = videoUrl !== undefined ? 'video' : imageUrl !== undefined ? 'image' : undefined;
  const ref = compact({
    channel: 'meta_instagram',
    // `ad_id` presente é prova de anúncio mesmo se `source` faltar.
    sourceType: source ?? (adId !== undefined ? 'ad' : 'unknown'),
    sourceId: adId ?? (ctx ? cleanId(ctx['post_id']) : undefined),
    headline: ctx ? cleanString(ctx['ad_title']) : undefined,
    ref: cleanString(raw['ref']),
    imageUrl,
    videoUrl,
    mediaType,
    referredAt,
  });
  return hasIdentifyingData(ref) ? ref : undefined;
}

/**
 * `true` quando o referral é de mídia paga (o que conta como `origem:anuncio`).
 *
 * No WhatsApp, `source_type:"post"` é um POST IMPULSIONADO (Click-to-WhatsApp
 * criado a partir de post) — também é anúncio. No IG só `ADS` é pago.
 */
export function isPaidAdReferral(r: AdReferral | undefined): boolean {
  if (r === undefined) return false;
  if (r.sourceType === 'ad') return true;
  return r.channel === 'meta_whatsapp' && r.sourceType === 'post';
}

/**
 * Lê de volta um `AdReferral` que foi para `metadata.adReferral` (jsonb) — o
 * caminho do worker. Revalida em vez de confiar no cast: o metadata passa por
 * serialização e pode vir de linha antiga.
 */
export function readAdReferral(v: unknown): AdReferral | undefined {
  if (!isRecord(v)) return undefined;
  const channel = v['channel'];
  if (channel !== 'meta_whatsapp' && channel !== 'meta_instagram') return undefined;
  const sourceType = cleanString(v['sourceType']);
  const referredAt = cleanString(v['referredAt']);
  if (sourceType === undefined || referredAt === undefined) return undefined;
  const ref = compact({
    channel,
    sourceType,
    sourceId: cleanString(v['sourceId']),
    sourceUrl: cleanUrl(v['sourceUrl']),
    headline: cleanString(v['headline']),
    body: cleanString(v['body']),
    mediaType: cleanString(v['mediaType']),
    ctwaClid: cleanString(v['ctwaClid']),
    ref: cleanString(v['ref']),
    imageUrl: cleanUrl(v['imageUrl']),
    videoUrl: cleanUrl(v['videoUrl']),
    thumbnailUrl: cleanUrl(v['thumbnailUrl']),
    referredAt,
  });
  return hasIdentifyingData(ref) ? ref : undefined;
}

/**
 * Colunas de atribuição como gravadas em `contacts` e `deals` (migração 0082).
 * Nomes em camelCase = propriedades Drizzle. Sem URLs de mídia (expiram).
 */
export interface AdAttributionColumns {
  readonly adChannel: AdReferralChannel;
  readonly adSourceType: string;
  readonly adSourceId: string | null;
  readonly adSourceUrl: string | null;
  readonly adHeadline: string | null;
  readonly adBody: string | null;
  readonly adMediaType: string | null;
  readonly adCtwaClid: string | null;
  readonly adReferredAt: Date;
}

/**
 * Converte o referral nas colunas persistidas. O worker usa assim (primeiro
 * toque — só grava se o contato ainda não tem atribuição):
 *
 * ```ts
 * await tx.update(contacts).set(toAdAttributionColumns(ref))
 *   .where(and(eq(contacts.id, id), isNull(contacts.adReferredAt)));
 * ```
 */
export function toAdAttributionColumns(r: AdReferral): AdAttributionColumns {
  const at = new Date(r.referredAt);
  return {
    adChannel: r.channel,
    adSourceType: r.sourceType,
    adSourceId: r.sourceId ?? null,
    adSourceUrl: r.sourceUrl ?? null,
    adHeadline: r.headline ?? null,
    adBody: r.body ?? null,
    adMediaType: r.mediaType ?? null,
    adCtwaClid: r.ctwaClid ?? null,
    adReferredAt: Number.isNaN(at.getTime()) ? new Date() : at,
  };
}

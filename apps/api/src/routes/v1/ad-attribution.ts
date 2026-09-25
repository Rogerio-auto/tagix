/**
 * Atribuição de anúncio na API pública v1 (F70-S05).
 *
 * No banco são 9 colunas planas `ad_*` (consultáveis e indexadas); no contrato
 * público viram UM objeto `adAttribution` — ou `null` quando o contato/deal não
 * veio de anúncio. Quem integra lê `contact.adAttribution?.sourceId` em vez de
 * testar nove campos soltos, e a API pode ganhar campo novo sem espalhar chaves
 * pela raiz do recurso.
 */

/** Forma pública (camelCase, datas ISO). */
export interface AdAttributionDto {
  readonly channel: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly sourceUrl: string | null;
  readonly headline: string | null;
  readonly body: string | null;
  readonly mediaType: string | null;
  readonly ctwaClid: string | null;
  readonly referredAt: string;
}

/** As colunas como o Drizzle as devolve de `contacts`/`deals`. */
export interface AdAttributionRow {
  adChannel: string | null;
  adSourceType: string | null;
  adSourceId: string | null;
  adSourceUrl: string | null;
  adHeadline: string | null;
  adBody: string | null;
  adMediaType: string | null;
  adCtwaClid: string | null;
  adReferredAt: Date | null;
}

type AdKey = keyof AdAttributionRow;

const AD_KEYS: ReadonlySet<string> = new Set<AdKey>([
  'adChannel',
  'adSourceType',
  'adSourceId',
  'adSourceUrl',
  'adHeadline',
  'adBody',
  'adMediaType',
  'adCtwaClid',
  'adReferredAt',
]);

/** Extrai o DTO; `null` sem atribuição (o CHECK garante tudo-ou-nada no núcleo). */
export function toAdAttributionDto(row: AdAttributionRow): AdAttributionDto | null {
  if (row.adChannel === null || row.adSourceType === null || row.adReferredAt === null) return null;
  return {
    channel: row.adChannel,
    sourceType: row.adSourceType,
    sourceId: row.adSourceId,
    sourceUrl: row.adSourceUrl,
    headline: row.adHeadline,
    body: row.adBody,
    mediaType: row.adMediaType,
    ctwaClid: row.adCtwaClid,
    referredAt: row.adReferredAt.toISOString(),
  };
}

/**
 * Tira as colunas planas `ad*` da linha e põe o objeto `adAttribution`. Genérico
 * para servir contato e deal sem duplicar.
 */
export function withAdAttribution<R extends AdAttributionRow>(
  row: R,
): Omit<R, AdKey> & { adAttribution: AdAttributionDto | null } {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!AD_KEYS.has(k)) rest[k] = v;
  return { ...(rest as Omit<R, AdKey>), adAttribution: toAdAttributionDto(row) };
}

/**
 * Atribuição de anúncio (F70-S05) — colunas compartilhadas por `contacts` e `deals`.
 *
 * Desenho: colunas planas (não jsonb) porque o dado é CONSULTADO — "quantos
 * leads e quanto faturamento veio do anúncio X" é um GROUP BY por
 * `ad_source_id`, e a devolução de conversão para a Meta (F69-S06) lê o
 * `ad_ctwa_clid` de um deal. jsonb esconderia o contrato e exigiria índice de
 * expressão; o referral bruto completo continua em `messages.metadata.adReferral`.
 *
 * Semântica difere por tabela, com o mesmo formato:
 * - `contacts`: PRIMEIRO TOQUE. De onde a pessoa veio na primeira vez. O writer
 *   só grava `WHERE ad_referred_at IS NULL`; um clique em outro anúncio meses
 *   depois não reescreve a aquisição.
 * - `deals`: o anúncio que originou AQUELA oportunidade (deal = 1 por conversa).
 *   É o `ctwa_clid` do deal que vai para a Conversions API quando ele fecha.
 *
 * URLs de mídia do criativo NÃO são persistidas: expiram na CDN da Meta.
 *
 * Invariante (CHECK): `ad_channel`, `ad_source_type` e `ad_referred_at` são
 * todos nulos (sem atribuição) ou todos preenchidos — não existe atribuição
 * pela metade. Os demais campos são opcionais porque a Meta os omite conforme o
 * tipo de referral (ex.: `ctwa_clid` não vem em todo clique).
 *
 * RLS: colunas novas em tabelas que já têm policy por `workspace_id` — nada a
 * acrescentar.
 */
import { sql, type SQL } from 'drizzle-orm';
import { check, index, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Canais que emitem referral de anúncio. */
export const AD_ATTRIBUTION_CHANNELS = ['meta_whatsapp', 'meta_instagram'] as const;
export type AdAttributionChannel = (typeof AD_ATTRIBUTION_CHANNELS)[number];

/**
 * Builders das colunas. Função (não constante) porque cada tabela precisa de
 * instâncias próprias de coluna.
 */
export function adAttributionColumns() {
  return {
    adChannel: text('ad_channel').$type<AdAttributionChannel>(),
    /** `ad` | `post` | outro valor da Meta em minúsculas. */
    adSourceType: text('ad_source_type'),
    /** ID do anúncio (WA `source_id` / IG `ad_id`) ou do post impulsionado. */
    adSourceId: text('ad_source_id'),
    adSourceUrl: text('ad_source_url'),
    adHeadline: text('ad_headline'),
    adBody: text('ad_body'),
    adMediaType: text('ad_media_type'),
    /** Click ID do Click-to-WhatsApp (Conversions API). */
    adCtwaClid: text('ad_ctwa_clid'),
    adReferredAt: timestamp('ad_referred_at', { withTimezone: true }),
  };
}

interface AdAttributionTableColumns {
  readonly workspaceId: AnyPgColumn;
  readonly adChannel: AnyPgColumn;
  readonly adSourceType: AnyPgColumn;
  readonly adSourceId: AnyPgColumn;
  readonly adReferredAt: AnyPgColumn;
}

function allNullOrAllSet(t: AdAttributionTableColumns): SQL {
  return sql`(${t.adChannel} is null) = (${t.adReferredAt} is null) and (${t.adChannel} is null) = (${t.adSourceType} is null)`;
}

/** CHECKs + índice parcial de relatório por anúncio. `table` = nome SQL da tabela. */
export function adAttributionConstraints(table: string, t: AdAttributionTableColumns) {
  return [
    check(
      `${table}_ad_channel_chk`,
      sql`${t.adChannel} is null or ${t.adChannel} in ('meta_whatsapp','meta_instagram')`,
    ),
    check(`${table}_ad_attribution_chk`, allNullOrAllSet(t)),
    // Parcial: a grande maioria das linhas não tem anúncio; o índice só carrega
    // as que têm e atende "tudo do anúncio X" dentro do workspace.
    index(`idx_${table}_ad_source`)
      .on(t.workspaceId, t.adSourceId)
      .where(sql`${t.adSourceId} is not null`),
  ] as const;
}

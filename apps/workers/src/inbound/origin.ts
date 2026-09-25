/**
 * Origem da conversa e atribuição de anúncio no inbound (F70-S07).
 *
 * Liga no pipeline o que a F70-S05 deixou pronto em `@hm/channels`:
 *
 * - **Origem** (`conversations.origin`): classificada UMA vez, quando a conversa
 *   nasce, por `classifyConversationOrigin` — referral de anúncio, texto
 *   pré-preenchido dos botões do site/Instagram (marcadores de
 *   `workspaces.settings`, default vazio) ou o próprio canal (Direct do IG). O que
 *   não prova nada é `sem-origem`. A etiqueta de mesmo nome vai para o contato.
 * - **Primeiro toque** (`contacts.ad_*`): o primeiro referral de anúncio que o
 *   contato traz. `WHERE ad_referred_at IS NULL` não é otimização, é a regra: um
 *   segundo anúncio nunca sobrescreve o primeiro, e reentrega/corrida entre
 *   consumidores vira no-op.
 *
 * Tudo roda DENTRO do `withWorkspace` do chamador (RLS).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import {
  adReferralFromInboundEvent,
  classifyConversationOrigin,
  toAdAttributionColumns,
  type AdReferral,
  type InboundEvent,
} from '@hm/channels';
import {
  originPrefillMarkersFromSettings,
  type ChannelProvider,
  type ConversationOriginValue,
  type OriginPrefillMarkersConfig,
} from '@hm/shared';

/** Primeiro referral de anúncio num lote de eventos (ordem de chegada). */
export function firstAdReferral(events: readonly InboundEvent[]): AdReferral | undefined {
  for (const event of events) {
    const ref = adReferralFromInboundEvent(event);
    if (ref !== undefined) return ref;
  }
  return undefined;
}

/** Texto da primeira mensagem do contato que tem texto. */
function firstInboundText(events: readonly InboundEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === 'message' && event.content !== undefined && event.content.trim() !== '') {
      return event.content;
    }
  }
  return undefined;
}

/** Marcadores dos botões do site/Instagram configurados no workspace (default vazio). */
export async function loadOriginPrefillMarkers(
  tx: DbTx,
  workspaceId: string,
): Promise<OriginPrefillMarkersConfig> {
  const [row] = await tx
    .select({ settings: schema.workspaces.settings })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return originPrefillMarkersFromSettings(row?.settings);
}

/**
 * Origem de uma conversa que o CONTATO acabou de abrir (inbound). Conversa aberta
 * pelo negócio (eco do app) é prospecção e é decidida no worker de coexistência.
 */
export function classifyInboundConversation(input: {
  readonly provider: ChannelProvider;
  readonly events: readonly InboundEvent[];
  readonly markers: OriginPrefillMarkersConfig;
}): ConversationOriginValue {
  const adReferral = firstAdReferral(input.events);
  const text = firstInboundText(input.events);
  return classifyConversationOrigin({
    provider: input.provider,
    initiatedBy: 'contact',
    ...(adReferral !== undefined ? { adReferral } : {}),
    ...(text !== undefined ? { firstInboundText: text } : {}),
    prefillMarkers: input.markers,
  });
}

/**
 * Grava a atribuição de anúncio no contato — só o PRIMEIRO toque. Retorna `true`
 * se gravou agora (o contato ainda não tinha atribuição).
 */
export async function recordFirstTouchAttribution(
  tx: DbTx,
  contactId: string,
  events: readonly InboundEvent[],
): Promise<boolean> {
  const ref = firstAdReferral(events);
  if (ref === undefined) return false;
  const { contacts } = schema;
  const updated = await tx
    .update(contacts)
    .set({ ...toAdAttributionColumns(ref), updatedAt: new Date() })
    .where(and(eq(contacts.id, contactId), isNull(contacts.adReferredAt)))
    .returning({ id: contacts.id });
  return updated.length > 0;
}

/**
 * Etiqueta o contato com a origem da conversa. Etiquetas no Leadium são do
 * CONTATO (`contact_tags`) — não há etiqueta de conversa no schema. Idempotente:
 * a tag é criada uma vez por workspace (`tags_workspace_name_uq`) e o vínculo é
 * PK (contact, tag).
 */
export async function applyOriginTag(
  tx: DbTx,
  workspaceId: string,
  contactId: string,
  tagName: ConversationOriginValue,
  taggedBy: string | null,
): Promise<void> {
  const { tags, contactTags } = schema;

  const [created] = await tx
    .insert(tags)
    .values({ workspaceId, name: tagName })
    .onConflictDoNothing({ target: [tags.workspaceId, tags.name] })
    .returning({ id: tags.id });
  let tagId = created?.id;
  if (tagId === undefined) {
    const [existing] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, tagName)))
      .limit(1);
    tagId = existing?.id;
  }
  if (tagId === undefined) {
    throw new Error('origem: etiqueta não materializou após upsert.');
  }

  await tx
    .insert(contactTags)
    .values({ contactId, tagId, workspaceId, taggedBy })
    .onConflictDoNothing();
}

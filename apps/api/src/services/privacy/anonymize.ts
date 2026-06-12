/**
 * Anonimização de PII de um titular (F10-S02 / LGPD — direito ao esquecimento).
 *
 * Estratégia: NÃO deletamos as linhas de agregado (deals, conversion_events,
 * conversations, messages) — isso quebraria métricas históricas e integridade
 * referencial. Em vez disso, substituímos a PII por tokens DETERMINÍSTICOS
 * (`deleted-{hash}`, derivados do id do contato) e redigimos texto livre que possa
 * conter dados pessoais (corpo de mensagens/notas, custom fields). O contato é
 * marcado com `deleted_at` (soft-delete) para sair das visões operacionais.
 *
 * Determinismo: o token vem de SHA-256(`workspace_id:contact_id`), então a mesma
 * pessoa anonimizada produz sempre o mesmo token — permite correlação interna sem
 * reidentificação externa.
 *
 * Tudo roda DENTRO da transação RLS-escopada recebida (`tx`), em um único commit.
 */
import { createHash } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { DbTx } from '@hm/db';
import { schema } from '@hm/db';

/** `count(*)::int` tipado — evita `any` no select de contagem. */
const countInt = sql<number>`count(*)::int`;

const { contacts, conversations, messages, conversationNotes, deals, contactTags } = schema;

/** Placeholder fixo para texto redigido (corpo de mensagem/nota). */
export const REDACTED_TEXT = '[redacted-lgpd]' as const;

/** Token determinístico curto derivado de (workspaceId, contactId). */
export function deterministicToken(workspaceId: string, contactId: string): string {
  const hash = createHash('sha256').update(`${workspaceId}:${contactId}`).digest('hex');
  return `deleted-${hash.slice(0, 16)}`;
}

export interface ForgetResult {
  readonly token: string;
  readonly conversationsAnonymized: number;
  readonly messagesRedacted: number;
  readonly notesRedacted: number;
  readonly dealsRedacted: number;
}

/**
 * Anonimiza/redige toda a PII do contato `contactId` (assume-se que o contato existe
 * e pertence ao workspace — a RLS do `tx` garante o escopo). Idempotente: rodar de
 * novo sobre um contato já anonimizado reescreve os mesmos tokens.
 */
export async function anonymizeContact(
  tx: DbTx,
  workspaceId: string,
  contactId: string,
  now: Date,
): Promise<ForgetResult> {
  const token = deterministicToken(workspaceId, contactId);

  // 1) Raiz: a linha do contato. Toda PII direta → token/null; soft-delete.
  await tx
    .update(contacts)
    .set({
      displayName: token,
      phone: null,
      email: null,
      avatarUrl: null,
      notes: null,
      source: null,
      optInSource: null,
      optInMethod: null,
      optOutReason: null,
      customFields: {},
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(contacts.id, contactId));

  // 2) Conversas do contato: limpa previews/identificadores legíveis. As linhas
  //    permanecem (FK de mensagens/deals); só removemos texto que expõe a pessoa.
  const convRows = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.contactId, contactId));
  const conversationIds = convRows.map((r) => r.id);

  if (conversationIds.length > 0) {
    await tx
      .update(conversations)
      .set({
        lastMessagePreview: null,
        groupName: null,
        groupAvatarUrl: null,
        updatedAt: now,
      })
      .where(inArray(conversations.id, conversationIds));

    // 3) Mensagens dessas conversas: redige corpo + legenda + payloads que podem
    //    carregar PII (texto digitado pela pessoa, mídia, interativos).
    await tx
      .update(messages)
      .set({
        content: REDACTED_TEXT,
        mediaUrl: null,
        mediaCaption: null,
        interactivePayload: null,
        metadata: {},
        updatedAt: now,
      })
      .where(inArray(messages.conversationId, conversationIds));

    // 4) Notas internas dessas conversas: o corpo pode descrever a pessoa.
    await tx
      .update(conversationNotes)
      .set({ body: REDACTED_TEXT, updatedAt: now })
      .where(inArray(conversationNotes.conversationId, conversationIds));
  }

  // 5) Deals do contato: mantém a linha (agregado), mas redige texto livre (notes)
  //    e custom fields que possam conter PII. value/stage/conversões intactos.
  await tx
    .update(deals)
    .set({ notes: null, customFields: {}, updatedAt: now })
    .where(eq(deals.contactId, contactId));

  // 6) Tags do contato: vínculos não são PII por si, mas removemos para que o
  //    titular anonimizado não permaneça segmentável por atributos pessoais.
  await tx.delete(contactTags).where(eq(contactTags.contactId, contactId));

  // Contagens p/ o registro de auditoria (best-effort: re-conta o que foi tocado).
  const [msgCount] = conversationIds.length
    ? await tx
        .select({ n: countInt })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
    : [{ n: 0 }];
  const [noteCount] = conversationIds.length
    ? await tx
        .select({ n: countInt })
        .from(conversationNotes)
        .where(inArray(conversationNotes.conversationId, conversationIds))
    : [{ n: 0 }];
  const [dealCount] = await tx
    .select({ n: countInt })
    .from(deals)
    .where(eq(deals.contactId, contactId));

  return {
    token,
    conversationsAnonymized: conversationIds.length,
    messagesRedacted: msgCount?.n ?? 0,
    notesRedacted: noteCount?.n ?? 0,
    dealsRedacted: dealCount?.n ?? 0,
  };
}

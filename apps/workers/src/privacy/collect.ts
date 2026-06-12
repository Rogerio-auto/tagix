/**
 * Coleta de PII para o artefato de export (F10-S02 / LGPD — direito de acesso).
 *
 * Dado um `scope` (workspace inteiro ou um único titular), reúne todos os dados
 * pessoais espalhados pelo domínio, SEMPRE dentro da transação RLS-escopada (`tx`)
 * — nada cruza tenant. O resultado é um objeto JSON-serializável que o processador
 * grava como artefato baixável.
 *
 * O escopo `contact` é o pedido do titular (export individual); `workspace` é o
 * export administrativo de todos os titulares do tenant.
 */
import { desc, eq } from 'drizzle-orm';
import type { DataExportScope, DbTx } from '@hm/db';
import { schema } from '@hm/db';

const { contacts, conversations, messages, conversationNotes, deals, conversionEvents } = schema;

/** Limite de linhas por coleção no export de workspace (evita artefatos gigantes). */
const WORKSPACE_ROW_CAP = 50_000;

export interface ExportArtifact {
  readonly generatedAt: string;
  readonly workspaceId: string;
  readonly scope: DataExportScope;
  readonly contacts: unknown[];
  readonly conversations: unknown[];
  readonly messages: unknown[];
  readonly conversationNotes: unknown[];
  readonly deals: unknown[];
  readonly conversionEvents: unknown[];
}

/** Reúne a PII do scope em um objeto serializável. */
export async function collectExport(
  tx: DbTx,
  workspaceId: string,
  scope: DataExportScope,
  now: Date,
): Promise<ExportArtifact> {
  const base = {
    generatedAt: now.toISOString(),
    workspaceId,
    scope,
  } as const;

  if (scope.kind === 'contact') {
    const contactRows = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.id, scope.contactId))
      .limit(1);

    const convRows = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, scope.contactId))
      .orderBy(desc(conversations.createdAt));
    const conversationIds = convRows.map((c) => c.id);

    const msgRows = await collectByConversations(tx, conversationIds);

    const dealRows = await tx.select().from(deals).where(eq(deals.contactId, scope.contactId));
    const convEventRows = await tx
      .select()
      .from(conversionEvents)
      .where(eq(conversionEvents.contactId, scope.contactId));

    return {
      ...base,
      contacts: contactRows,
      conversations: convRows,
      messages: msgRows.messages,
      conversationNotes: msgRows.notes,
      deals: dealRows,
      conversionEvents: convEventRows,
    };
  }

  // scope.kind === 'workspace': RLS já restringe ao tenant; aplicamos só o cap.
  const contactRows = await tx.select().from(contacts).limit(WORKSPACE_ROW_CAP);
  const convRows = await tx
    .select()
    .from(conversations)
    .orderBy(desc(conversations.createdAt))
    .limit(WORKSPACE_ROW_CAP);
  const msgRows = await tx
    .select()
    .from(messages)
    .orderBy(desc(messages.createdAt))
    .limit(WORKSPACE_ROW_CAP);
  const noteRows = await tx.select().from(conversationNotes).limit(WORKSPACE_ROW_CAP);
  const dealRows = await tx.select().from(deals).limit(WORKSPACE_ROW_CAP);
  const convEventRows = await tx.select().from(conversionEvents).limit(WORKSPACE_ROW_CAP);

  return {
    ...base,
    contacts: contactRows,
    conversations: convRows,
    messages: msgRows,
    conversationNotes: noteRows,
    deals: dealRows,
    conversionEvents: convEventRows,
  };
}

/** Mensagens + notas das conversas de um titular (vazio se não houver conversas). */
async function collectByConversations(
  tx: DbTx,
  conversationIds: string[],
): Promise<{ messages: unknown[]; notes: unknown[] }> {
  if (conversationIds.length === 0) return { messages: [], notes: [] };
  const msgRows: unknown[] = [];
  const noteRows: unknown[] = [];
  for (const cid of conversationIds) {
    const m = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, cid))
      .orderBy(desc(messages.createdAt));
    msgRows.push(...m);
    const n = await tx
      .select()
      .from(conversationNotes)
      .where(eq(conversationNotes.conversationId, cid));
    noteRows.push(...n);
  }
  return { messages: msgRows, notes: noteRows };
}

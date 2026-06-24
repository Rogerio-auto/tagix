/**
 * Card-da-conversa + cadastro read-through + snapshot no fechamento
 * (F47-S04, COCKPIT_CLIENT_ENRICHMENT §4).
 *
 * Este módulo conecta a CONVERSA (LiveChat) ao CARD (pipeline) e ao CADASTRO
 * vivo do contato. Mora em `pipeline/**` (muro do slot) e é montado pelo
 * agregador do pipeline ANTES do router de deals (app.ts: pipeline → deals),
 * o que importa para o read-through enriquecido de `GET /api/deals/:id`.
 *
 * Endpoints (todos sob /api, RLS via req.scoped):
 *   POST /api/conversations/:id/deal   cria/auto-cria o card ligado à conversa   (deal.edit)
 *   GET  /api/deals/:id                detalhe do card + cadastro read-through    (deal.edit)
 *   POST /api/deals/:id/close-won      [pré-handler] grava snapshot, depois next() (deal.edit)
 *   POST /api/deals/:id/close-lost     [pré-handler] grava snapshot, depois next() (deal.edit)
 *
 * Decisões (founder, §2):
 *  - READ-THROUGH: o card exibe o cadastro VIVO do contato (`deal.contact_id` →
 *    contato), sempre fresco, sem cópia divergente. Nada é copiado para o deal.
 *  - SNAPSHOT no FECHAMENTO: ao fechar (won/lost) grava-se
 *    `deal.custom_fields.contact_snapshot` com o cadastro vigente — fidelidade
 *    histórica (ex.: endereço de entrega como era na venda). O snapshot é
 *    aditivo: o close real (deals/crud) só toca closedAt/closedWon/updatedAt,
 *    preservando `custom_fields`. Por isso o snapshot roda como PRÉ-HANDLER
 *    (mesma rota) e chama `next()` — sem duplicar a lógica de close.
 *  - IDEMPOTÊNCIA: `ensureDealForConversation` é a fonte única da criação. A rota
 *    e o auto-create do 1º enriquecimento (S03/S07) a invocam; se a conversa já
 *    tem deal, devolve o existente (nunca cria um segundo).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { assertConversationVisible, schema } from '@hm/db';
import type { DbTx } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

const { conversations, contacts, deals, pipelines, stages } = schema;

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return typeof raw === 'string' ? raw : '';
}

/** Linha de deal retornada pelo ensure/detalhe (campos estáveis p/ o frontend). */
export type EnsuredDeal = typeof schema.deals.$inferSelect;

/**
 * Garante o card (deal) ligado à conversa — IDEMPOTENTE.
 *
 * Se a conversa já tem deal vinculado (`deals.conversation_id`), devolve o mais
 * recente sem criar outro. Caso contrário, cria um deal no PIPELINE DEFAULT do
 * workspace (fallback: pipeline mais antigo) no estágio de menor `position`
 * (fallback: estágio mais antigo), com `contact_id` da conversa e título = nome
 * do contato (fallback: telefone, depois "Negócio").
 *
 * Mora aqui (a CRIAÇÃO pertence a este slot). É reutilizável: a rota
 * `POST /api/conversations/:id/deal` e o auto-create do 1º enriquecimento
 * (itens/valor sem deal — S03/S07) devem invocá-la em vez de inserir direto.
 *
 * Roda DENTRO de `req.scoped` (RLS já escopa o tenant). NÃO faz guard de
 * visibilidade da conversa — quem chama (a rota) é responsável por isso.
 *
 * Retorna `null` quando a conversa não existe (no escopo RLS) OU o workspace não
 * tem nenhum pipeline/estágio configurado (não há onde ancorar o card).
 */
export async function ensureDealForConversation(
  tx: DbTx,
  conversationId: string,
  opts: { workspaceId: string; actorMemberId?: string | null },
): Promise<EnsuredDeal | null> {
  // 1. Já existe deal para esta conversa? Idempotência: devolve o existente.
  const [existing] = await tx
    .select()
    .from(deals)
    .where(eq(deals.conversationId, conversationId))
    .orderBy(desc(deals.createdAt))
    .limit(1);
  if (existing) return existing;

  // 2. Carrega a conversa (RLS) p/ pegar contato + título do card.
  const [conv] = await tx
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv || !conv.contactId) return null;

  const [contact] = await tx
    .select({ displayName: contacts.displayName, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.id, conv.contactId))
    .limit(1);

  // 3. Pipeline default (fallback: o mais antigo) + estágio de entrada.
  const [pipeline] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.isActive, true))
    .orderBy(desc(pipelines.isDefault), pipelines.createdAt)
    .limit(1);
  if (!pipeline) return null;

  const [stage] = await tx
    .select({ id: stages.id })
    .from(stages)
    .where(eq(stages.pipelineId, pipeline.id))
    .orderBy(stages.position)
    .limit(1);
  if (!stage) return null;

  const title = contact?.displayName?.trim() || contact?.phone?.trim() || 'Negócio';

  const [created] = await tx
    .insert(deals)
    .values({
      workspaceId: opts.workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: conv.contactId,
      conversationId,
      title,
      valueCents: 0,
      currency: 'BRL',
      source: 'conversation',
    })
    .returning();
  if (!created) return null;

  await tx.insert(schema.dealHistory).values({
    dealId: created.id,
    workspaceId: opts.workspaceId,
    eventType: 'created',
    actorMemberId: opts.actorMemberId ?? null,
    actorType: opts.actorMemberId ? 'member' : 'system',
  });

  return created;
}

/**
 * Lê o cadastro VIVO do contato dono do deal e grava-o em
 * `deal.custom_fields.contact_snapshot` na MESMA transação. Idempotente
 * (sempre sobrescreve com o cadastro vigente). `null` se o deal não existir
 * no escopo RLS.
 */
export async function snapshotContactForDeal(tx: DbTx, dealId: string): Promise<EnsuredDeal | null> {
  const [deal] = await tx
    .select()
    .from(deals)
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!deal) return null;

  const [contact] = await tx
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
      phone: contacts.phone,
      email: contacts.email,
      document: contacts.document,
      address: contacts.address,
      customFields: contacts.customFields,
    })
    .from(contacts)
    .where(eq(contacts.id, deal.contactId))
    .limit(1);

  const snapshot = {
    contactId: deal.contactId,
    displayName: contact?.displayName ?? null,
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    document: contact?.document ?? null,
    address: contact?.address ?? {},
    customFields: contact?.customFields ?? {},
    capturedAt: new Date().toISOString(),
  };

  const nextCustomFields = { ...deal.customFields, contact_snapshot: snapshot };
  const [updated] = await tx
    .update(deals)
    .set({ customFields: nextCustomFields, updatedAt: new Date() })
    .where(eq(deals.id, dealId))
    .returning();
  return updated ?? null;
}

/** Cadastro vivo do contato anexado ao detalhe do deal/conversa (read-through). */
export type ContactReadThrough = {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  document: string | null;
  address: typeof schema.contacts.$inferSelect['address'];
  customFields: Record<string, unknown>;
};

/** Carrega o cadastro vivo do contato (read-through) dentro do escopo RLS. */
export async function loadContactReadThrough(
  tx: DbTx,
  contactId: string,
): Promise<ContactReadThrough | null> {
  const [c] = await tx
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
      phone: contacts.phone,
      email: contacts.email,
      document: contacts.document,
      address: contacts.address,
      customFields: contacts.customFields,
    })
    .from(contacts)
    .where(and(eq(contacts.id, contactId)))
    .limit(1);
  if (!c) return null;
  return {
    id: c.id,
    displayName: c.displayName,
    phone: c.phone,
    email: c.email,
    document: c.document,
    address: c.address,
    customFields: c.customFields,
  };
}

export function createDealConversationRouter(): Router {
  const router = Router();
  const editGuard = [requireAuth, withRLS, requireRole('deal.edit')] as const;

  // ─── POST /api/conversations/:id/deal — cria/auto-cria o card (idempotente) ──
  // Guard de visibilidade por-conversa (F30-S07.1): 404 = não confirma a conversa
  // a quem não a enxerga (evita IDOR), precedendo qualquer criação.
  router.post(
    '/api/conversations/:id/deal',
    ...editGuard,
    async (req: Request, res: Response) => {
      const conversationId = param(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const memberId = req.auth!.member.id;
      const role = req.auth!.member.role as Role;
      const workspaceId = req.auth!.workspace.id;

      const result = await req.scoped!(async (tx) => {
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return { kind: 'not_visible' as const };
        }
        const deal = await ensureDealForConversation(tx, conversationId, {
          workspaceId,
          actorMemberId: memberId,
        });
        if (!deal) return { kind: 'no_pipeline' as const };
        return { kind: 'ok' as const, deal };
      });

      if (result.kind === 'not_visible') {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if (result.kind === 'no_pipeline') {
        res.status(422).json({
          error: 'no_default_pipeline',
          message: 'Nenhum pipeline/estágio configurado para ancorar o card.',
        });
        return;
      }
      res.status(201).json({ deal: result.deal });
    },
  );

  // ─── GET /api/deals/:id — detalhe do card + cadastro read-through ────────────
  // Montado ANTES do router de deals (app.ts) → é a fonte do detalhe enriquecido.
  // Devolve `{ deal, contact }` (contract S04): o `deal` preserva o shape do CRUD
  // e `contact` é o cadastro VIVO (read-through), nunca uma cópia.
  router.get('/api/deals/:id', ...editGuard, async (req: Request, res: Response) => {
    const dealId = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId)).limit(1);
      if (!deal) return null;
      const contact = await loadContactReadThrough(tx, deal.contactId);
      return { deal, contact };
    });
    if (!result) {
      res.sendStatus(404);
      return;
    }
    res.json({ deal: result.deal, contact: result.contact });
  });

  // ─── Snapshot no fechamento (pré-handler, mesma rota) ────────────────────────
  // Grava `custom_fields.contact_snapshot` ANTES de o close real (deals/crud)
  // rodar. `next()` deixa o handler canônico fazer o fechamento. Se o deal não
  // existir (null), apenas segue — o close canônico responde 404.
  const snapshotThenNext = [
    ...editGuard,
    async (req: Request, res: Response, next: NextFunction) => {
      const dealId = param(req, 'id');
      await req.scoped!((tx) => snapshotContactForDeal(tx, dealId));
      next();
    },
  ] as const;

  router.post('/api/deals/:id/close-won', ...snapshotThenNext);
  router.post('/api/deals/:id/close-lost', ...snapshotThenNext);

  return router;
}

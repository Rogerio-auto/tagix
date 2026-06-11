/**
 * API geral de contatos (CRM) — DATA_MODEL §5.1/§5.2, DASHBOARD §13.
 *
 * Hoje só existia opt-in.ts (consentimento). Este módulo entrega o CRUD geral:
 *   GET    /api/contacts                 lista paginada + busca/filtros (contact.view)
 *   GET    /api/contacts/:id             detalhe + tags + conversas + deals + conversões + consentimento (contact.view)
 *   POST   /api/contacts                 cria (contact.edit)
 *   PATCH  /api/contacts/:id             edita (contact.edit)
 *   DELETE /api/contacts/:id             soft-delete (contact.delete)
 *   POST   /api/contacts/:id/tags        atribui tag (contact.edit)
 *   DELETE /api/contacts/:id/tags/:tagId remove tag (contact.edit)
 *
 * Tudo sob RLS (req.scoped). Busca por nome/phone/email com paginação keyset-free
 * (offset/limit — volumes por workspace cabem nisso; cursor fica p/ F-perf futura).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const {
  contacts,
  tags,
  contactTags,
  conversations,
  deals,
  conversionEvents,
  conversionTypes,
} = schema;

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tagId: z.string().uuid().optional(),
  source: z.string().trim().max(120).optional(),
  optIn: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['recent', 'name']).default('recent'),
});

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(40).nullish(),
  email: z.string().trim().email().max(200).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  language: z.string().trim().max(16).nullish(),
  source: z.string().trim().max(120).nullish(),
  ownerId: z.string().uuid().nullish(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = createSchema.partial();

const assignTagSchema = z.object({ tagId: z.string().uuid() });

/** Normaliza um termo de busca livre p/ uso em ILIKE (escapa wildcards do LIKE). */
function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (m) => `\\${m}`);
  return `%${escaped}%`;
}

export function createContactsCrudRouter(): Router {
  const router = Router();
  const viewGuard = [requireAuth, withRLS, requireRole('contact.view')] as const;
  const editGuard = [requireAuth, withRLS, requireRole('contact.edit')] as const;
  const deleteGuard = [requireAuth, withRLS, requireRole('contact.delete')] as const;

  // ─── GET /api/contacts — lista paginada + busca/filtros ────────────────────
  router.get('/api/contacts', ...viewGuard, async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const { q, tagId, source, optIn, page, pageSize, sort } = parsed.data;

    const conds = [isNull(contacts.deletedAt)];
    if (q) {
      const pat = likePattern(q);
      conds.push(
        or(
          ilike(contacts.displayName, pat),
          ilike(contacts.phone, pat),
          ilike(sql`${contacts.email}::text`, pat),
        )!,
      );
    }
    if (source) conds.push(eq(contacts.source, source));
    if (optIn) conds.push(eq(contacts.marketingOptIn, optIn === 'true'));
    if (tagId) {
      conds.push(
        sql`exists (select 1 from ${contactTags} ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${tagId})`,
      );
    }
    const where = and(...conds);
    const orderBy = sort === 'name' ? asc(contacts.displayName) : desc(contacts.createdAt);

    const { rows, total } = await req.scoped!(async (tx) => {
      const rows = await tx
        .select()
        .from(contacts)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(contacts)
        .where(where);
      return { rows, total: countRows[0]?.count ?? 0 };
    });

    res.json({
      contacts: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  });

  // ─── GET /api/contacts/:id — detalhe agregado ──────────────────────────────
  router.get('/api/contacts/:id', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const result = await req.scoped!(async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
        .limit(1);
      if (!contact) return null;

      const contactTagRows = await tx
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
          taggedAt: contactTags.taggedAt,
        })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(eq(contactTags.contactId, id))
        .orderBy(asc(tags.name));

      const conversationRows = await tx
        .select({
          id: conversations.id,
          channelId: conversations.channelId,
          status: conversations.status,
          lastMessagePreview: conversations.lastMessagePreview,
          lastMessageAt: conversations.lastMessageAt,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .where(eq(conversations.contactId, id))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(50);

      const dealRows = await tx
        .select({
          id: deals.id,
          title: deals.title,
          stageId: deals.stageId,
          closedAt: deals.closedAt,
          closedWon: deals.closedWon,
          valueCents: deals.valueCents,
          currency: deals.currency,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .where(eq(deals.contactId, id))
        .orderBy(desc(deals.createdAt))
        .limit(50);

      const conversionRows = await tx
        .select({
          id: conversionEvents.id,
          typeId: conversionEvents.conversionTypeId,
          typeKey: conversionTypes.key,
          typeLabel: conversionTypes.label,
          valueCents: conversionEvents.valueCents,
          currency: conversionEvents.currency,
          cancelledAt: conversionEvents.cancelledAt,
          occurredAt: conversionEvents.occurredAt,
        })
        .from(conversionEvents)
        .leftJoin(conversionTypes, eq(conversionTypes.id, conversionEvents.conversionTypeId))
        .where(eq(conversionEvents.contactId, id))
        .orderBy(desc(conversionEvents.occurredAt))
        .limit(50);

      return { contact, tags: contactTagRows, conversations: conversationRows, deals: dealRows, conversions: conversionRows };
    });

    if (!result) {
      res.sendStatus(404);
      return;
    }

    // Timeline de consentimento derivada das colunas do contato.
    const c = result.contact;
    const consent = [
      c.optInAt
        ? { kind: 'opt_in' as const, at: c.optInAt, method: c.optInMethod, source: c.optInSource }
        : null,
      c.optOutAt
        ? { kind: 'opt_out' as const, at: c.optOutAt, reason: c.optOutReason }
        : null,
    ]
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({ ...result, consent, marketingOptIn: c.marketingOptIn });
  });

  // ─── GET /api/contacts/:id/consent — timeline de consentimento ─────────────
  router.get('/api/contacts/:id/consent', ...viewGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [contact] = await req.scoped!((tx) =>
      tx
        .select({
          marketingOptIn: contacts.marketingOptIn,
          optInMethod: contacts.optInMethod,
          optInSource: contacts.optInSource,
          optInAt: contacts.optInAt,
          optOutAt: contacts.optOutAt,
          optOutReason: contacts.optOutReason,
        })
        .from(contacts)
        .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
        .limit(1),
    );
    if (!contact) {
      res.sendStatus(404);
      return;
    }
    const timeline = [
      contact.optInAt
        ? { kind: 'opt_in' as const, at: contact.optInAt, method: contact.optInMethod, source: contact.optInSource }
        : null,
      contact.optOutAt
        ? { kind: 'opt_out' as const, at: contact.optOutAt, reason: contact.optOutReason }
        : null,
    ]
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json({ marketingOptIn: contact.marketingOptIn, timeline });
  });

  // ─── POST /api/contacts — cria ─────────────────────────────────────────────
  router.post('/api/contacts', ...editGuard, async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const workspaceId = req.auth!.workspace.id;
    const d = parsed.data;
    try {
      const [created] = await req.scoped!((tx) =>
        tx
          .insert(contacts)
          .values({
            workspaceId,
            displayName: d.displayName,
            phone: d.phone ?? null,
            email: d.email ?? null,
            notes: d.notes ?? null,
            language: d.language ?? 'pt-BR',
            source: d.source ?? 'manual',
            ownerId: d.ownerId ?? null,
            customFields: d.customFields ?? {},
          })
          .returning(),
      );
      res.status(201).json({ contact: created });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'duplicate_phone', message: 'Já existe um contato com esse telefone.' });
        return;
      }
      throw err;
    }
  });

  // ─── PATCH /api/contacts/:id — edita ───────────────────────────────────────
  router.patch('/api/contacts/:id', ...editGuard, async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patch[k] = v;
    }
    try {
      const [updated] = await req.scoped!((tx) =>
        tx
          .update(contacts)
          .set(patch)
          .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
          .returning(),
      );
      if (!updated) {
        res.sendStatus(404);
        return;
      }
      res.json({ contact: updated });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'duplicate_phone', message: 'Já existe um contato com esse telefone.' });
        return;
      }
      throw err;
    }
  });

  // ─── DELETE /api/contacts/:id — soft-delete ────────────────────────────────
  router.delete('/api/contacts/:id', ...deleteGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const [deleted] = await req.scoped!((tx) =>
      tx
        .update(contacts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
        .returning({ id: contacts.id }),
    );
    if (!deleted) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  // ─── POST /api/contacts/:id/tags — atribui tag ─────────────────────────────
  router.post('/api/contacts/:id/tags', ...editGuard, async (req: Request, res: Response) => {
    const parsed = assignTagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    const id = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    const { tagId } = parsed.data;

    const result = await req.scoped!(async (tx) => {
      const [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
        .limit(1);
      if (!contact) return 'no_contact' as const;

      const [tag] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.id, tagId))
        .limit(1);
      if (!tag) return 'no_tag' as const;

      await tx
        .insert(contactTags)
        .values({ contactId: id, tagId, workspaceId, taggedBy: memberId })
        .onConflictDoNothing();
      return 'ok' as const;
    });

    if (result === 'no_contact') {
      res.sendStatus(404);
      return;
    }
    if (result === 'no_tag') {
      res.status(404).json({ error: 'tag_not_found' });
      return;
    }
    res.sendStatus(204);
  });

  // ─── DELETE /api/contacts/:id/tags/:tagId — remove tag ─────────────────────
  router.delete('/api/contacts/:id/tags/:tagId', ...editGuard, async (req: Request, res: Response) => {
    const id = param(req, 'id');
    const tagId = param(req, 'tagId');
    const [removed] = await req.scoped!((tx) =>
      tx
        .delete(contactTags)
        .where(and(eq(contactTags.contactId, id), eq(contactTags.tagId, tagId)))
        .returning({ tagId: contactTags.tagId }),
    );
    if (!removed) {
      res.sendStatus(404);
      return;
    }
    res.sendStatus(204);
  });

  return router;
}

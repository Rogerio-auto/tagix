/**
 * `/api/copilot/sessions*` e `/api/copilot/turns/:id/cancel` (F73-S10; COPILOTO.md §5.2).
 *
 *   POST   /api/copilot/sessions                    cria (origem e, opcional, contexto de página)
 *   GET    /api/copilot/sessions?cursor=&limit=     só as DO MEMBRO, não arquivadas, recentes primeiro
 *   GET    /api/copilot/sessions/:id/messages       histórico (dono), página "carregar anteriores"
 *   PATCH  /api/copilot/sessions/:id                renomeia (dono)
 *   DELETE /api/copilot/sessions/:id                arquiva (dono; some da lista)
 *   POST   /api/copilot/sessions/:id/messages       pergunta → SSE (`services/copilot/turns`)
 *   POST   /api/copilot/turns/:id/cancel            "Parar" (dono)
 *
 * Montado por `createCopilotRouter`, DEPOIS da porta `requireAuth → withRLS → copilotAvailable`
 * (view-as, `copilot.use`, Copiloto desligado, matriz do papel). Sessões são PRIVADAS: a de
 * outro membro responde 404, igual a uma inexistente (sem oráculo).
 *
 * Só leitura (assinatura inativa): o guard de assinatura deixa passar criar sessão e
 * perguntar (perguntar é leitura); a escrita é recusada no callback das ferramentas
 * (ADR-003 §5). Renomear, arquivar e "Parar" seguem a regra geral do guard.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  InvalidCursorError,
  copilotMessagesRepo,
  copilotSessionsRepo,
  type CopilotSettingsView,
  type DbTx,
} from '@hm/db';
import { createLogger } from '@hm/logger';
import {
  AskBody,
  CopilotMessagePageSchema,
  CopilotSessionPageSchema,
  CopilotSessionSchema,
  CreateSessionBody,
  CursorSchema,
  ROLES,
  RenameSessionBody,
  type CopilotRunRequest,
  type Role,
} from '@hm/shared';
import { COPILOT_TOOLS } from '../../../internal/copilot';
import {
  buildCopilotPrincipal,
  type CopilotPrincipal,
} from '../../../services/copilot/identity/principal';
import {
  COPILOT_TURN_DEADLINE_MS,
  COPILOT_SSE_HEARTBEAT_MS,
  cancelTurn,
  createRedisCopilotRateLimiter,
  handleAsk,
  platformDefaultModel,
  resolvePageContext,
  runtimeFromEnv,
  type CopilotTurnDeps,
} from '../../../services/copilot/turns';
import { COPILOT_ROLE_LABELS_PT } from '../me';
import { toMessageDTO, toSessionDTO } from './dto';

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);
const UuidParam = z.string().uuid();
const PageQuery = z.object({
  cursor: CursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

interface RouteContext {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
  readonly settings: CopilotSettingsView;
  readonly scoped: <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;
}

/** Papel, configuração e transação já resolvidos pela porta; sem eles o request não chega aqui. */
function context(req: Request): RouteContext | null {
  const auth = req.auth;
  const settings = req.copilot?.settings;
  const scoped = req.scoped;
  if (!auth || !settings || !scoped || !ROLE_SET.has(auth.member.role)) return null;
  return {
    workspaceId: auth.workspace.id,
    memberId: auth.member.id,
    role: auth.member.role as Role,
    settings,
    scoped,
  };
}

function principalFor(req: Request, ctx: RouteContext): CopilotPrincipal {
  const auth = req.auth!;
  return buildCopilotPrincipal({
    workspaceId: ctx.workspaceId,
    memberId: ctx.memberId,
    role: ctx.role,
    memberStatus: auth.member.status,
    subscriptionStatus: auth.workspace.subscriptionStatus,
    trialEndsAt: auth.workspace.trialEndsAt,
    settings: ctx.settings,
  });
}

/** O que o modelo sabe de quem pergunta: nome, papel, idioma e fuso. Nada de identificador. */
function memberForRuntime(req: Request, role: Role): CopilotRunRequest['member'] {
  const auth = req.auth!;
  const name = (auth.member.name ?? '').trim();
  return {
    display_name: (name.length > 0 ? name : 'Membro da equipe').slice(0, 120),
    role_label: COPILOT_ROLE_LABELS_PT[role],
    locale: (auth.member.localeOverride ?? auth.workspace.locale ?? 'pt-BR').slice(0, 35),
    timezone: (auth.member.timezone ?? auth.workspace.timezone ?? 'America/Sao_Paulo').slice(0, 64),
  };
}

function paramId(req: Request): string | null {
  const raw = req.params['id'];
  const id = typeof raw === 'string' ? raw : '';
  return UuidParam.safeParse(id).success ? id.toLowerCase() : null;
}

function unauthorized(res: Response): void {
  res.status(401).json({ message: 'Não autenticado.', error: 'session_invalid' });
}

function invalidBody(res: Response): void {
  res.status(400).json({ message: 'Pedido inválido.', error: 'invalid_body' });
}

function sessionNotFound(res: Response): void {
  res.status(404).json({ message: 'Conversa não encontrada.', error: 'session_not_found' });
}

export interface CopilotSessionsRouterOptions {
  /** Substitui dependências do turno (testes: runtime falso, relógio, heartbeat curto). */
  readonly turnDeps?: Partial<CopilotTurnDeps>;
}

function defaultTurnDeps(overrides: Partial<CopilotTurnDeps>): CopilotTurnDeps {
  const logger =
    overrides.logger ?? createLogger('info', { svc: '@hm/api', component: 'copilot-turn' });
  return {
    runtime: overrides.runtime ?? runtimeFromEnv(),
    rateLimiter: overrides.rateLimiter ?? createRedisCopilotRateLimiter({ logger }),
    tools: overrides.tools ?? COPILOT_TOOLS,
    logger,
    now: overrides.now ?? (() => new Date()),
    heartbeatMs: overrides.heartbeatMs ?? COPILOT_SSE_HEARTBEAT_MS,
    defaultModel: overrides.defaultModel ?? platformDefaultModel(),
    deadlineMs: overrides.deadlineMs ?? COPILOT_TURN_DEADLINE_MS,
    ...(overrides.grantSecret ? { grantSecret: overrides.grantSecret } : {}),
  };
}

export function createCopilotSessionsRouter(options: CopilotSessionsRouterOptions = {}): Router {
  const router = Router();
  let deps: CopilotTurnDeps | null = null;
  // Preguiçoso: o router é montado no boot, e o Redis/runtime só são tocados no 1º pedido.
  const turnDeps = (): CopilotTurnDeps => (deps ??= defaultTurnDeps(options.turnDeps ?? {}));

  router.post('/api/copilot/sessions', async (req: Request, res: Response): Promise<void> => {
    const ctx = context(req);
    if (!ctx) return unauthorized(res);
    const parsed = CreateSessionBody.safeParse(req.body);
    if (!parsed.success) return invalidBody(res);
    const principal = principalFor(req, ctx);
    const row = await ctx.scoped(async (tx) => {
      const resolved = parsed.data.page_context
        ? await resolvePageContext(tx, principal, parsed.data.page_context)
        : null;
      return copilotSessionsRepo.create(tx, {
        workspaceId: ctx.workspaceId,
        memberId: ctx.memberId,
        origin: parsed.data.origin,
        lastPageContext: resolved?.stored ?? null,
      });
    });
    res.status(201).json(CopilotSessionSchema.parse(toSessionDTO(row)));
  });

  router.get('/api/copilot/sessions', async (req: Request, res: Response): Promise<void> => {
    const ctx = context(req);
    if (!ctx) return unauthorized(res);
    const query = PageQuery.safeParse(req.query);
    if (!query.success) return invalidBody(res);
    try {
      const page = await ctx.scoped((tx) =>
        copilotSessionsRepo.listByMember(tx, {
          memberId: ctx.memberId,
          cursor: query.data.cursor ?? null,
          ...(query.data.limit !== undefined ? { limit: query.data.limit } : {}),
        }),
      );
      res.json(
        CopilotSessionPageSchema.parse({
          data: page.items.map(toSessionDTO),
          next_cursor: page.nextCursor,
        }),
      );
    } catch (err: unknown) {
      if (err instanceof InvalidCursorError) {
        res.status(400).json({ message: 'Cursor inválido.', error: 'invalid_cursor' });
        return;
      }
      throw err;
    }
  });

  router.get(
    '/api/copilot/sessions/:id/messages',
    async (req: Request, res: Response): Promise<void> => {
      const ctx = context(req);
      if (!ctx) return unauthorized(res);
      const id = paramId(req);
      if (!id) return sessionNotFound(res);
      const query = PageQuery.safeParse(req.query);
      if (!query.success) return invalidBody(res);
      try {
        const page = await ctx.scoped(async (tx) => {
          const session = await copilotSessionsRepo.getOwned(tx, id, ctx.memberId);
          if (!session) return null;
          return copilotMessagesRepo.listBySession(tx, {
            sessionId: id,
            cursor: query.data.cursor ?? null,
            ...(query.data.limit !== undefined ? { limit: query.data.limit } : {}),
          });
        });
        if (!page) return sessionNotFound(res);
        res.json(
          CopilotMessagePageSchema.parse({
            data: page.items.map(toMessageDTO),
            next_cursor: page.nextCursor,
          }),
        );
      } catch (err: unknown) {
        if (err instanceof InvalidCursorError) {
          res.status(400).json({ message: 'Cursor inválido.', error: 'invalid_cursor' });
          return;
        }
        throw err;
      }
    },
  );

  router.patch('/api/copilot/sessions/:id', async (req: Request, res: Response): Promise<void> => {
    const ctx = context(req);
    if (!ctx) return unauthorized(res);
    const id = paramId(req);
    if (!id) return sessionNotFound(res);
    const parsed = RenameSessionBody.safeParse(req.body);
    if (!parsed.success) return invalidBody(res);
    const row = await ctx.scoped((tx) =>
      copilotSessionsRepo.rename(tx, id, ctx.memberId, parsed.data.title),
    );
    if (!row) return sessionNotFound(res);
    res.json(CopilotSessionSchema.parse(toSessionDTO(row)));
  });

  router.delete('/api/copilot/sessions/:id', async (req: Request, res: Response): Promise<void> => {
    const ctx = context(req);
    if (!ctx) return unauthorized(res);
    const id = paramId(req);
    if (!id) return sessionNotFound(res);
    const row = await ctx.scoped((tx) => copilotSessionsRepo.archive(tx, id, ctx.memberId));
    if (!row) return sessionNotFound(res);
    res.status(204).end();
  });

  router.post(
    '/api/copilot/sessions/:id/messages',
    async (req: Request, res: Response): Promise<void> => {
      const ctx = context(req);
      if (!ctx) return unauthorized(res);
      const id = paramId(req);
      if (!id) return sessionNotFound(res);
      // `.strict()` em tudo: campo extra no corpo ou no contexto de página → 400.
      const parsed = AskBody.safeParse(req.body);
      if (!parsed.success) return invalidBody(res);
      const session = await ctx.scoped((tx) => copilotSessionsRepo.getOwned(tx, id, ctx.memberId));
      if (!session) return sessionNotFound(res);
      if (session.archivedAt) {
        res
          .status(409)
          .json({ message: 'Esta conversa foi arquivada.', error: 'session_archived' });
        return;
      }
      await handleAsk(
        {
          req,
          res,
          scoped: ctx.scoped,
          principal: principalFor(req, ctx),
          member: memberForRuntime(req, ctx.role),
          session,
          body: parsed.data,
        },
        turnDeps(),
      );
    },
  );

  router.post(
    '/api/copilot/turns/:id/cancel',
    async (req: Request, res: Response): Promise<void> => {
      const ctx = context(req);
      if (!ctx) return unauthorized(res);
      const id = paramId(req);
      const notFound = (): void => {
        res.status(404).json({ message: 'Pedido não encontrado.', error: 'turn_not_found' });
      };
      if (!id) return notFound();
      const result = await cancelTurn(ctx.scoped, { turnId: id, memberId: ctx.memberId });
      if (!result) return notFound();
      res.json({ turn_id: result.turnId, status: result.status });
    },
  );

  return router;
}

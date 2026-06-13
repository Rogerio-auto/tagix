/**
 * Middleware de impersonation -- view-as READ-ONLY (F26-S05, secao 6).
 *
 * Decisao travada: v1 e SO view-as read-only (sem act-as/escrita). Quando ha um claim
 * de impersonation valido (cookie `hm_impersonation` = id de uma impersonation_session
 * ativa), este middleware:
 *
 *   1. Exige que a sessao normal (req.auth) ja esteja resolvida e que o member
 *      autenticado seja EXATAMENTE o admin que abriu a sessao E seja platform-admin.
 *      Claim que nao bate com a sessao -> 403 (anti-tampering).
 *   2. BLOQUEIA qualquer metodo nao-GET (POST/PUT/PATCH/DELETE) com 403 -- read-only duro.
 *   3. NEGA acesso a rotas de plataforma (/api/platform/*) e a qualquer rota de secret
 *      durante a impersonation -- o admin nao opera a plataforma "pelos olhos" do tenant,
 *      e secrets nunca cruzam a fronteira de visualizacao.
 *   4. Sobrepoe o workspace do contexto (req.auth.workspace) pelo workspace-ALVO, de modo
 *      que o `withRLS`/`withWorkspace` a jusante leia os dados do tenant impersonado.
 *
 * Sessao expirada/encerrada/ausente -> NO-OP (volta ao fluxo normal). Deve ser montado
 * DEPOIS do authenticate de sessao e ANTES das rotas de workspace (wire do orchestrator).
 * NUNCA expoe secret/token. O `reason`/inicio/fim sao auditados na API (impersonation.ts).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { impersonationSessionsRepo, workspacesRepo } from '@hm/db';

/** Cookie que carrega o id da impersonation_session ativa (separado da sessao normal). */
export const IMPERSONATION_COOKIE = 'hm_impersonation';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Presente somente quando ha uma sessao de view-as ativa neste request. */
      impersonation?: {
        sessionId: string;
        targetWorkspaceId: string;
        adminMemberId: string;
        mode: 'view';
      };
    }
  }
}

/** Le o valor de um cookie pelo nome, sem depender de cookie-parser. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Detecta rota de plataforma ou de secret -- proibidas durante impersonation. */
function isForbiddenPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.startsWith('/api/platform') || p.includes('/secret');
}

/**
 * Resolve o claim de impersonation (se houver) e impoe as invariantes de read-only.
 * Sem claim valido -> next() sem alterar nada.
 */
export const impersonationMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const claim = readCookie(req, IMPERSONATION_COOKIE);
  if (!claim) {
    next();
    return;
  }

  void (async () => {
    const session = await impersonationSessionsRepo.findActiveById(claim, new Date());
    // Sessao inexistente/expirada/encerrada -> ignora o claim (volta ao normal).
    if (!session) {
      next();
      return;
    }

    // Anti-tampering: precisa de sessao normal, e o admin tem de ser o dono do claim
    // E continuar sendo platform-admin. Caso contrario, recusa (nao vaza contexto).
    const member = req.auth?.member;
    if (!member || !member.isPlatformAdmin || member.id !== session.adminMemberId) {
      res.status(403).json({ error: 'impersonation_claim_rejected' });
      return;
    }

    // READ-ONLY duro: qualquer metodo que nao seja GET/HEAD e bloqueado.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(403).json({
        error: 'impersonation_read_only',
        message: 'View-as e somente leitura. Encerre a sessao para escrever.',
      });
      return;
    }

    // Plataforma e secrets ficam fora do alcance durante a impersonation.
    if (isForbiddenPath(req.originalUrl || req.path)) {
      res.status(403).json({ error: 'impersonation_forbidden_route' });
      return;
    }

    // Sobrepoe o workspace do contexto pelo ALVO -> o withRLS a jusante le o tenant.
    const target = await workspacesRepo.findById(session.targetWorkspaceId);
    if (!target) {
      // Workspace alvo sumiu (ex.: deletado) -> recusa em vez de cair no normal.
      res.status(409).json({ error: 'impersonation_target_missing' });
      return;
    }
    if (req.auth) req.auth.workspace = target;
    req.impersonation = {
      sessionId: session.id,
      targetWorkspaceId: session.targetWorkspaceId,
      adminMemberId: session.adminMemberId,
      mode: 'view',
    };
    next();
  })().catch(next);
};

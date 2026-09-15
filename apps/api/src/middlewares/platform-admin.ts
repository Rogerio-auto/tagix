/**
 * Guard de plataforma (F25-S01, PERMISSIONS.md nível plataforma) —
 * `requirePlatformAdmin`.
 *
 * A camada de super-admin NÃO é workspace-scoped (sem RLS de tenant): este guard
 * é a ÚNICA fronteira de acesso da API de plataforma. Por isso vem antes de tudo
 * (S02–S05 montam seus routers atrás dele).
 *
 * Reusa `requireAuth` (resolve a sessão e popula `req.auth`); em cima dele exige
 * `member.isPlatformAdmin = true`. Acesso negado de um usuário autenticado vai a
 * `audit_logs` (actor_type 'platform_admin') — trilha de tentativas de acesso à
 * camada mais sensível do produto. Sem sessão → 401 (silencioso, sem audit: não
 * há actor).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import { requireAuth } from './auth';

const { auditLogs } = schema;

/** A tentativa negada, como vai para `audit_logs`. */
export interface DeniedAccess {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly path: string;
  readonly method: string;
}

export type DeniedAccessWriter = (entry: DeniedAccess) => Promise<void>;

const writeDeniedToDb: DeniedAccessWriter = async (entry) => {
  await getDb()
    .insert(auditLogs)
    .values({
      workspaceId: entry.workspaceId,
      actorMemberId: entry.memberId,
      actorType: 'platform_admin',
      action: 'platform.access_denied',
      resourceType: 'platform',
      metadata: { path: entry.path, method: entry.method },
    });
};

export interface PlatformAdminGuardDeps {
  /** Default: grava em `audit_logs`. Injetável para testar ordem e falha da gravação. */
  readonly writeDenied?: DeniedAccessWriter;
  /** Onde a falha de gravação da auditoria é registrada. */
  readonly logger?: { error(msg: string, meta?: Record<string, unknown>): void };
  /**
   * Quanto a negação espera a gravação antes de responder mesmo assim. Default 2s: banco travado
   * ou pool esgotado não pode segurar o 403 pelo timeout do driver (~30s).
   */
  readonly auditTimeoutMs?: number;
}

const DEFAULT_AUDIT_TIMEOUT_MS = 2000;

/** Erro de gravação no log sem virar vazamento: o Drizzle anexa os parâmetros à mensagem. */
const MAX_ERROR_CHARS = 300;

class AuditTimeoutError extends Error {
  constructor(ms: number) {
    super(`gravação da auditoria excedeu ${ms}ms`);
    this.name = 'AuditTimeoutError';
  }
}

type AuditLogger = NonNullable<PlatformAdminGuardDeps['logger']>;

const defaultLogger: AuditLogger = createLogger('info', { svc: '@hm/api' });

/**
 * Grava a tentativa de acesso negado à camada de plataforma.
 *
 * Nunca lança: a negação sai de qualquer jeito. Mas a falha de gravação vai para o log com o
 * motivo — uma trilha de acesso à camada mais sensível do produto que pode faltar sem aviso não
 * prova nada (F25-S10).
 */
async function auditDenied(
  req: Request,
  write: DeniedAccessWriter,
  logger: AuditLogger,
  timeoutMs: number,
): Promise<void> {
  const member = req.auth?.member;
  if (!member) return;
  const entry: DeniedAccess = {
    workspaceId: member.workspaceId,
    memberId: member.id,
    // Sem query string: um token passado na URL não pode acabar gravado na trilha nem no log.
    path: `${req.baseUrl}${req.path}`,
    method: req.method,
  };
  try {
    // `then` converte lançamento síncrono do gravador em rejeição, tratada abaixo.
    await comTimeout(Promise.resolve().then(() => write(entry)), timeoutMs);
  } catch (err: unknown) {
    const motivo = err instanceof Error ? err.message : String(err);
    registrarFalha(
      logger,
      err instanceof AuditTimeoutError
        ? 'platform.access_denied.audit_timeout'
        : 'platform.access_denied.audit_failed',
      { ...entry, error: motivo.slice(0, MAX_ERROR_CHARS) },
    );
  }
}

/** Espera a gravação até `ms`; depois segue. A gravação lenta continua, só não segura a resposta. */
async function comTimeout(tarefa: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AuditTimeoutError(ms)), ms);
    timer.unref?.();
  });
  try {
    await Promise.race([tarefa, limite]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Destino de log fora do ar não pode transformar a negação em 500. */
function registrarFalha(logger: AuditLogger, msg: string, meta: Record<string, unknown>): void {
  try {
    logger.error(msg, meta);
  } catch {
    // Sem onde registrar: a negação sai de qualquer jeito.
  }
}

/**
 * Exige uma sessão autenticada cujo member seja `is_platform_admin`.
 * 401 (sem sessão) / 403 (autenticado sem privilégio, auditado) / next() (ok).
 *
 * ## Por que a auditoria é aguardada antes do 403 (F25-S10)
 *
 * Antes, `void auditDenied(req)` respondia na hora e gravava depois. A tentativa negada podia
 * ficar sem registro — processo encerrando, banco lento — e o teste que conferia a trilha passava
 * ou falhava conforme a velocidade do banco. Negação é o caminho raro: uma escrita a mais antes da
 * resposta custa pouco e fecha a trilha.
 */
export function createPlatformAdminGuard(deps: PlatformAdminGuardDeps = {}): RequestHandler[] {
  const write = deps.writeDenied ?? writeDeniedToDb;
  const logger = deps.logger ?? defaultLogger;
  const timeoutMs = deps.auditTimeoutMs ?? DEFAULT_AUDIT_TIMEOUT_MS;
  return [
    requireAuth,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!req.auth?.member.isPlatformAdmin) {
        await auditDenied(req, write, logger, timeoutMs);
        res.status(403).json({ message: 'Acesso restrito a administradores de plataforma.' });
        return;
      }
      next();
    },
  ];
}

/** Exportado para os slots S02–S05 montarem seus routers de plataforma. */
export const requirePlatformAdmin: RequestHandler[] = createPlatformAdminGuard();

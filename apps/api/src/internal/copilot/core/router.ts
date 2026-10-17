/**
 * Callback interno das ferramentas do Copiloto (F73-S03; ADR-003 §3; COPILOTO.md §5.4).
 *
 *   POST /internal/copilot/tools/:key
 *   Authorization: Bearer AGENT_RUNTIME_TOKEN
 *   X-Copilot-Grant: <grant do turno>
 *   { turn_id, call_id, args }
 *
 * Toda chamada reautoriza do zero, falhando fechado, nesta ordem:
 *   1. bearer de serviço (o MESMO guard do caminho de agente, por import)  → 401
 *   2. grant: HMAC em tempo constante, versão, `exp`                       → 401 `grant_*`
 *   3. corpo `.strict()` e `turn_id` igual ao do grant                      → 400 / 403
 *   4. sob `withWorkspace(grant.ws)`: `claimToolCall` (turno vivo, do membro, nonce, teto),
 *      numa transação PRÓPRIA e já confirmada: a chamada é consumida mesmo que o resto
 *      falhe (R5: um modelo em loop não ganha chamadas de volta ao errar)  → 403 `turn_not_active`
 *      (falha do banco neste passo → 200 `decision: 'error'`, log só com código/constraint)
 *   5. sob `withWorkspace(grant.ws)`, numa segunda transação:
 *      a. recarrega o membro, o workspace e a configuração (principal)
 *      b. ferramenta no registro                                           → 404 `tool_not_found`
 *      c. `args` pelo Zod `.strict()` da ferramenta                         → `invalid_args`
 *      d. capacidade: papel ∧ matriz ∧ assinatura ∧ orçamento              → `denied`
 *      e. SÓ ENTÃO o handler, num savepoint; o envelope é validado contra o contrato e,
 *         se a ferramenta lê conteúdo de contato, o turno é marcado como contaminado ANTES
 *         de o resultado sair (`taint.ts`). Qualquer falha desfaz o savepoint inteiro.
 *      f. `copilot_tool_calls` gravado em TODOS os caminhos depois do passo 4, com
 *         `args_redacted` pelo redator do caminho de agente (por import): sem PII.
 *
 * Antes do passo 4 não há turno confiável para referenciar (a FK de `copilot_tool_calls`
 * exige o turno): as recusas dos passos 1–4 vão só para o log estruturado, com o motivo.
 *
 * Motivos estáveis (nunca com dado de negócio): `service_unauthorized`, `grant_*`,
 * `invalid_body`, `turn_not_active`, `tool_not_found`, `invalid_args`,
 * `capability_denied:<reason>`. Nenhum corpo de erro cru chega ao runtime.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { ZodIssue } from 'zod';
import {
  copilotToolCallsRepo,
  copilotTurnsRepo,
  withWorkspace,
  type ClaimedToolCall,
  type CopilotRiskLevel,
  type CopilotToolCallDecision,
  type DbTx,
} from '@hm/db';
import { createLogger, type Logger } from '@hm/logger';
import {
  CopilotToolCallBodySchema,
  CopilotToolEnvelopeSchema,
  CopilotToolKeySchema,
  isWriteCapability,
  type CopilotToolCallBody,
  type CopilotToolEnvelope,
} from '@hm/shared';
import { createInternalTokenGuard } from '../../tools/auth';
import { maskFreeText, redactLogArgs } from '../../tools/log-redaction';
import {
  authorizeCapability,
  type CopilotDenialReason,
} from '../../../services/copilot/identity/authorize';
import { loadCopilotBudget } from '../../../services/copilot/identity/budget';
import { verifyGrant, type CopilotGrantPayload } from '../../../services/copilot/identity/grant';
import {
  resolveCopilotPrincipal,
  type CopilotPrincipal,
} from '../../../services/copilot/identity/principal';
import {
  createCopilotToolRegistry,
  emitToolResult,
  type CopilotToolDefinition,
  type CopilotToolRegistry,
} from './registry';
import { taintTurnIfNeeded } from './taint';

export const COPILOT_TOOLS_PATH = '/internal/copilot/tools/:key';
export const COPILOT_GRANT_HEADER = 'x-copilot-grant';

/** Tamanho máximo serializado de `args_redacted`/`result_meta`. */
const LOG_SUMMARY_MAX = 4_000;
/** Quantos problemas de validação o modelo recebe de volta. */
const INVALID_ARGS_ISSUES_MAX = 5;

/** O que o modelo lê em cada recusa. Estável, sem dado de negócio, sem oráculo. */
export const COPILOT_MODEL_VIEWS = {
  error: 'A ferramenta falhou e não devolveu dados. Diga isso à pessoa e não invente o resultado.',
  invalidArgs:
    'Os argumentos não seguem o formato desta ferramenta; nada foi executado. Corrija e tente de novo.',
  denied: {
    role: 'Esta pessoa não tem permissão para isto no papel dela; nada foi executado. Diga isso com clareza.',
    capability_disabled:
      'Esta capacidade está desligada para o papel desta pessoa nas configurações do Copiloto; nada foi executado.',
    subscription_inactive:
      'A empresa está em modo só leitura (assinatura inativa): consultas seguem, mudanças não. Nada foi executado.',
    budget: 'O orçamento mensal do Copiloto chegou ao limite para esta ação; nada foi executado.',
    copilot_disabled: 'O Copiloto está desligado nesta empresa; nada foi executado.',
  } satisfies Record<CopilotDenialReason, string>,
} as const;

/** Erro interno do savepoint: desfaz a ferramenta e vira `decision: 'error'`. */
class ToolCallFailure extends Error {
  constructor(readonly code: 'invalid_envelope' | 'taint_failed') {
    super(code);
    this.name = 'ToolCallFailure';
  }
}

export interface CopilotToolsRouterOptions {
  /** Ferramentas registradas (composição em `internal/copilot/index.ts`). */
  readonly tools: readonly CopilotToolDefinition[];
  /** Override do token de serviço (testes). Default: `AGENT_RUNTIME_TOKEN`. */
  readonly token?: string;
  /** Override do segredo do grant (testes). Default: `COPILOT_GRANT_SECRET`. */
  readonly grantSecret?: Buffer;
  /** Relógio (testes). */
  readonly now?: () => Date;
  readonly logger?: Logger;
}

/** Só código/constraint do Postgres: a `message` do Drizzle embute os params (PII). */
function pgErrorFields(err: unknown): { code?: string; constraint?: string } {
  const cause: unknown = err instanceof Error ? err.cause : undefined;
  const pg = typeof cause === 'object' && cause !== null ? cause : {};
  return {
    ...('code' in pg ? { code: String(pg.code) } : {}),
    ...('constraint_name' in pg ? { constraint: String(pg.constraint_name) } : {}),
  };
}

/** Objeto JSON-serializável e pequeno para o log (`jsonb`). */
function summarize(value: Record<string, unknown>): Record<string, unknown> {
  try {
    const json = JSON.stringify(value);
    if (json.length > LOG_SUMMARY_MAX) return { truncated: true, length: json.length };
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return { unserializable: true };
  }
}

/**
 * `args` para `copilot_tool_calls.args_redacted`. As chaves de ferramenta do Copiloto não
 * têm política no redator do agente (o prefixo garante que nunca colidam com uma): sobra a
 * FORMA dos args (chaves mascaradas e tipos), nunca os valores.
 */
function redactArgs(toolKey: string, args: Record<string, unknown>): Record<string, unknown> {
  return summarize(redactLogArgs(`copilot:${toolKey}`, args));
}

/** Chave para o log: a do registro, ou um marcador quando o modelo inventou algo inválido. */
function loggableKey(rawKey: string): string {
  return CopilotToolKeySchema.safeParse(rawKey).success ? rawKey : 'invalid_key';
}

/** Problemas de validação para o modelo: caminho e código, nunca valores. */
function describeIssues(issues: readonly ZodIssue[]): string {
  const lines = issues.slice(0, INVALID_ARGS_ISSUES_MAX).map((issue) => {
    const path = issue.path.map((p) => maskFreeText(String(p))).join('.') || '(raiz)';
    const extra =
      issue.code === 'unrecognized_keys'
        ? ` (${issue.keys.map((k) => maskFreeText(k)).join(', ')})`
        : '';
    return `${path}: ${issue.code}${extra}`;
  });
  const more =
    issues.length > INVALID_ARGS_ISSUES_MAX ? ` (+${issues.length - INVALID_ARGS_ISSUES_MAX})` : '';
  return `${COPILOT_MODEL_VIEWS.invalidArgs} Problemas: ${lines.join('; ')}${more}.`;
}

/** Nível de risco do envelope, quando a ferramenta é de escrita (S05 o calcula). */
function riskLevelOf(envelope: CopilotToolEnvelope): CopilotRiskLevel | null {
  const event = envelope.public_event;
  if (!event) return null;
  if (event.type === 'action_receipt') return event.risk_level;
  if (event.type === 'action_proposed') return event.proposal.risk_level;
  return null;
}

interface CallOutcome {
  readonly status: number;
  readonly body: CopilotToolEnvelope | { readonly ok: false; readonly error: string };
  readonly decision: CopilotToolCallDecision;
  readonly errorCode: string | null;
  readonly resultMeta: Record<string, unknown>;
  readonly riskLevel: CopilotRiskLevel | null;
  readonly toolKey: string;
}

export function createCopilotToolsRouter(options: CopilotToolsRouterOptions): Router {
  const router = Router();
  const registry: CopilotToolRegistry = createCopilotToolRegistry(options.tools);
  const token = options.token ?? process.env['AGENT_RUNTIME_TOKEN'] ?? '';
  const tokenGuard = createInternalTokenGuard(token);
  const now = options.now ?? (() => new Date());
  const logger =
    options.logger ?? createLogger('info', { svc: '@hm/api', component: 'copilot-tools' });

  /**
   * O guard do caminho de agente responde sozinho (401/500, corpo genérico). Aqui só se
   * acrescenta o log com o motivo estável.
   */
  function serviceGuard(req: Request, res: Response, next: NextFunction): void {
    let passed = false;
    tokenGuard(req, res, () => {
      passed = true;
    });
    if (passed) {
      next();
      return;
    }
    logger.warn('copilot-tools: chamada recusada', { reason: 'service_unauthorized' });
  }

  function refuse(
    res: Response,
    status: number,
    reason: string,
    fields: Record<string, unknown> = {},
  ): void {
    logger.warn('copilot-tools: chamada recusada', { reason, ...fields });
    res.status(status).json({ ok: false, error: reason });
  }

  /** Passo 5: principal, ferramenta, args, autorização, handler, taint e log. */
  async function runCall(
    tx: DbTx,
    grant: CopilotGrantPayload,
    turn: ClaimedToolCall,
    rawKey: string,
    body: CopilotToolCallBody,
  ): Promise<CallOutcome> {
    const base = { toolKey: loggableKey(rawKey), riskLevel: null } as const;
    // a. Membro, workspace e configuração recarregados AGORA (sem cache).
    const principal: CopilotPrincipal | null = await resolveCopilotPrincipal(tx, {
      workspaceId: grant.ws,
      memberId: grant.mid,
      now: now(),
    });

    const tool = registry.get(rawKey);
    if (!tool) {
      return {
        ...base,
        status: 404,
        body: { ok: false, error: 'tool_not_found' },
        decision: 'denied',
        errorCode: 'tool_not_found',
        resultMeta: {},
      };
    }

    const parsed = tool.args.safeParse(body.args);
    if (!parsed.success) {
      return {
        ...base,
        status: 200,
        body: {
          ok: false,
          decision: 'invalid_args',
          model_view: describeIssues(parsed.error.issues),
        },
        decision: 'invalid_args',
        errorCode: 'invalid_args',
        resultMeta: { issues: parsed.error.issues.length },
      };
    }
    const args = parsed.data;

    let reason: CopilotDenialReason | null = null;
    if (!principal) {
      reason = 'role';
    } else {
      const budget = await loadCopilotBudget(tx, principal.settings, now());
      const decision = authorizeCapability(principal, tool.capability, {
        targetCount: tool.targetCount ? tool.targetCount(args) : 1,
        isWrite: isWriteCapability(tool.capability),
        budget: budget.state,
        ...(tool.requires ? { permissions: tool.requires } : {}),
      });
      if (!decision.allowed) reason = decision.reason;
    }
    if (reason !== null || !principal) {
      const denial: CopilotDenialReason = reason ?? 'role';
      return {
        ...base,
        status: 200,
        body: { ok: false, decision: 'denied', model_view: COPILOT_MODEL_VIEWS.denied[denial] },
        decision: 'denied',
        errorCode: `capability_denied:${denial}`,
        resultMeta: {},
      };
    }

    try {
      const envelope = await tx.transaction(async (sp) => {
        const raw = await tool.handler(
          { tx: sp, principal, turn, callId: body.call_id, emitResult: emitToolResult },
          args,
        );
        const checked = CopilotToolEnvelopeSchema.safeParse(raw);
        if (!checked.success) throw new ToolCallFailure('invalid_envelope');
        // P4: contaminação gravada ANTES de o resultado sair; se não grava, não sai.
        if (tool.taintsTurn && !(await taintTurnIfNeeded(sp, tool, turn.turnId))) {
          throw new ToolCallFailure('taint_failed');
        }
        return checked.data;
      });
      return {
        ...base,
        status: 200,
        body: envelope,
        decision: envelope.decision,
        errorCode: null,
        resultMeta: {
          ok: envelope.ok,
          ...(envelope.result_id !== undefined ? { result_id: envelope.result_id } : {}),
          ...(tool.taintsTurn ? { tainted: true } : {}),
        },
        riskLevel: riskLevelOf(envelope),
      };
    } catch (err) {
      const code = err instanceof ToolCallFailure ? err.code : 'handler_failed';
      logger.error('copilot-tools: falha na ferramenta', {
        ref: `hm_copilot_tool_${base.toolKey}`,
        toolKey: base.toolKey,
        code,
        workspaceId: grant.ws,
        turnId: turn.turnId,
        errorName: err instanceof Error ? err.name : typeof err,
        ...pgErrorFields(err),
      });
      return {
        ...base,
        status: 200,
        body: { ok: false, decision: 'error', model_view: COPILOT_MODEL_VIEWS.error },
        decision: 'error',
        errorCode: code,
        resultMeta: {},
      };
    }
  }

  router.post(COPILOT_TOOLS_PATH, serviceGuard, async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const rawParam = req.params['key'];
    const rawKey = typeof rawParam === 'string' ? rawParam : '';

    // 2. Grant.
    const verified = verifyGrant(req.header(COPILOT_GRANT_HEADER), {
      now: now(),
      ...(options.grantSecret ? { secret: options.grantSecret } : {}),
    });
    if (!verified.ok) {
      refuse(res, 401, verified.reason, { toolKey: loggableKey(rawKey) });
      return;
    }
    const grant = verified.payload;
    const ids = { workspaceId: grant.ws, memberId: grant.mid, turnId: grant.tid };

    // 3. Corpo e amarração ao turno do grant.
    const parsedBody = CopilotToolCallBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      refuse(res, 400, 'invalid_body', { toolKey: loggableKey(rawKey), ...ids });
      return;
    }
    const body = parsedBody.data;
    if (body.turn_id !== grant.tid) {
      refuse(res, 403, 'turn_not_active', { detail: 'turn_mismatch', ...ids });
      return;
    }

    // 4. Consome a chamada (transação própria, confirmada antes de qualquer execução).
    // Falha de banco aqui não pode cair no error handler genérico: a `message` do Drizzle
    // embute os parâmetros da query (ids, nonce). Só código/constraint vão para o log.
    let turn: ClaimedToolCall | null;
    try {
      turn = await withWorkspace(grant.ws, (tx) =>
        copilotTurnsRepo.claimToolCall(tx, {
          turnId: grant.tid,
          memberId: grant.mid,
          nonce: grant.nonce,
        }),
      );
    } catch (err) {
      logger.error('copilot-tools: falha ao consumir a chamada do turno', {
        ref: `hm_copilot_tool_${loggableKey(rawKey)}`,
        stage: 'claim',
        ...ids,
        errorName: err instanceof Error ? err.name : typeof err,
        ...pgErrorFields(err),
      });
      const failure: CopilotToolEnvelope = {
        ok: false,
        decision: 'error',
        model_view: COPILOT_MODEL_VIEWS.error,
      };
      res.status(200).json(failure);
      return;
    }
    if (!turn) {
      refuse(res, 403, 'turn_not_active', { toolKey: loggableKey(rawKey), ...ids });
      return;
    }

    // 5. Autoriza, executa e registra — tudo na mesma transação.
    let outcome: CallOutcome;
    try {
      outcome = await withWorkspace(grant.ws, async (tx) => {
        const result = await runCall(tx, grant, turn, rawKey, body);
        await copilotToolCallsRepo.insert(tx, {
          workspaceId: grant.ws,
          turnId: turn.turnId,
          memberId: grant.mid,
          toolKey: result.toolKey,
          decision: result.decision,
          argsRedacted: redactArgs(result.toolKey, body.args),
          resultMeta: summarize({ ...result.resultMeta, call: turn.toolCalls }),
          riskLevel: result.riskLevel,
          errorCode: result.errorCode,
          durationMs: Date.now() - startedAt,
        });
        return result;
      });
    } catch (err) {
      // Falha da transação (log ou commit): nada do handler ficou. Nunca vaza stack/PII.
      logger.error('copilot-tools: falha na transação da chamada', {
        ref: `hm_copilot_tool_${loggableKey(rawKey)}`,
        ...ids,
        errorName: err instanceof Error ? err.name : typeof err,
        ...pgErrorFields(err),
      });
      const failure: CopilotToolEnvelope = {
        ok: false,
        decision: 'error',
        model_view: COPILOT_MODEL_VIEWS.error,
      };
      res.status(200).json(failure);
      return;
    }

    if (outcome.decision === 'denied' || outcome.decision === 'invalid_args') {
      logger.warn('copilot-tools: chamada recusada', {
        reason: outcome.errorCode,
        toolKey: outcome.toolKey,
        ...ids,
      });
    }
    res.status(outcome.status).json(outcome.body);
  });

  return router;
}

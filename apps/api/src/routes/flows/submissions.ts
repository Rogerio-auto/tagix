/**
 * WhatsApp Flow (Meta) submission handler (F4-S14, DATA_MODEL secao 9.5, FLOW_BUILDER secao 5).
 *
 * Respostas de Meta Flows chegam no webhook unificado (F1-S02) como uma mensagem inbound
 * `interactive.nfm_reply`. Este modulo:
 *   1. resolve o canal -> workspace pelo `phone_number_id` do payload (mesma tenant-resolution);
 *   2. persiste `flow_submissions` (RLS), dedup por `external_id` (wamid do reply);
 *   3. dispara flows ATIVOS com trigger `flow_submission` cujo `meta_flow_id` casa.
 *
 * O despacho a partir do webhook Meta unificado e gap-fill do orchestrator (1-2 linhas):
 * chama `processMetaFlowSubmission` quando detecta o field de flow response.
 */
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema, withWorkspace } from '@hm/db';
import { triggerFlow as engineTriggerFlow } from '@hm/flow-engine';
import { createLogger, type Logger } from '@hm/logger';

const { channels, flows, flowSubmissions, conversations } = schema;

/** Payload normalizado de uma submission de Meta Flow (o que o handler precisa). */
export const metaFlowSubmissionSchema = z.object({
  /** phone_number_id do canal Meta (tenant-resolution). */
  phoneNumberId: z.string().min(1),
  /** ID Meta-side do flow respondido. */
  metaFlowId: z.string().min(1),
  /** wamid do reply (dedup). */
  externalId: z.string().optional(),
  /** remote id do contato (wa_id) para resolver a conversa. */
  contactRemoteId: z.string().optional(),
  /** resposta estruturada do flow (campos preenchidos). */
  response: z.record(z.unknown()),
});

export type MetaFlowSubmissionInput = z.infer<typeof metaFlowSubmissionSchema>;

/** Porta da engine (subset, injetavel p/ teste). */
export interface SubmissionEnginePort {
  triggerFlow(input: {
    workspaceId: string;
    flowId: string;
    conversationId?: string;
    contactId?: string;
    triggerData?: Record<string, unknown>;
    triggeredBy: 'manual' | 'automatic' | 'api';
  }): Promise<{ executionId: string }>;
}

export interface SubmissionDeps {
  readonly engine: SubmissionEnginePort;
  readonly logger: Logger;
}

export interface SubmissionResult {
  readonly resolved: boolean;
  readonly persisted: boolean;
  readonly deduped: boolean;
  readonly triggered: number;
}

/** Resolve canal -> {workspaceId, channelId} pelo phone_number_id (bypass RLS na borda). */
async function resolveChannel(
  phoneNumberId: string,
): Promise<{ workspaceId: string; channelId: string } | null> {
  const [row] = await getDb()
    .select({ id: channels.id, workspaceId: channels.workspaceId })
    .from(channels)
    .where(eq(channels.phoneNumberId, phoneNumberId));
  return row ? { workspaceId: row.workspaceId, channelId: row.id } : null;
}

/**
 * Processa uma submission de Meta Flow (testavel sem HTTP). Idempotente por `external_id`:
 * uma re-entrega do mesmo wamid nao re-persiste nem re-dispara. Sem flow correspondente,
 * persiste e no-op (sem erro).
 */
export async function processMetaFlowSubmission(
  input: MetaFlowSubmissionInput,
  deps: SubmissionDeps,
): Promise<SubmissionResult> {
  const channel = await resolveChannel(input.phoneNumberId);
  if (!channel) {
    deps.logger.warn('flow-submission: canal nao resolvido pelo phone_number_id', {
      phoneNumberId: input.phoneNumberId,
    });
    return { resolved: false, persisted: false, deduped: false, triggered: 0 };
  }
  const { workspaceId, channelId } = channel;

  return withWorkspace(workspaceId, async (tx) => {
    // Dedup por external_id (wamid): se ja existe, no-op.
    if (input.externalId) {
      const [existing] = await tx
        .select({ id: flowSubmissions.id })
        .from(flowSubmissions)
        .where(
          and(
            eq(flowSubmissions.channelId, channelId),
            eq(flowSubmissions.externalId, input.externalId),
          ),
        );
      if (existing) {
        return { resolved: true, persisted: false, deduped: true, triggered: 0 };
      }
    }

    // Resolve a conversa (opcional) pelo remote id do contato no canal.
    let conversationId: string | null = null;
    let contactId: string | null = null;
    if (input.contactRemoteId) {
      const [conv] = await tx
        .select({ id: conversations.id, contactId: conversations.contactId })
        .from(conversations)
        .where(
          and(
            eq(conversations.channelId, channelId),
            eq(conversations.remoteId, input.contactRemoteId),
          ),
        );
      if (conv) {
        conversationId = conv.id;
        contactId = conv.contactId;
      }
    }

    // Persiste a submission.
    await tx.insert(flowSubmissions).values({
      workspaceId,
      channelId,
      conversationId,
      metaFlowId: input.metaFlowId,
      externalId: input.externalId ?? null,
      response: input.response,
    });

    // Dispara flows ativos com trigger flow_submission cujo meta_flow_id casa.
    const candidates = await tx
      .select({ id: flows.id, triggerConfig: flows.triggerConfig })
      .from(flows)
      .where(and(eq(flows.status, 'active'), eq(flows.triggerType, 'flow_submission')));

    let triggered = 0;
    for (const flow of candidates) {
      const cfg = (flow.triggerConfig ?? {}) as Record<string, unknown>;
      if (cfg['meta_flow_id'] !== input.metaFlowId) continue;
      await deps.engine.triggerFlow({
        workspaceId,
        flowId: flow.id,
        conversationId: conversationId ?? undefined,
        contactId: contactId ?? undefined,
        triggerData: { meta_flow_id: input.metaFlowId, response: input.response },
        triggeredBy: 'automatic',
      });
      triggered += 1;
    }

    if (triggered > 0) {
      deps.logger.info('flow-submission: flows disparados', {
        metaFlowId: input.metaFlowId,
        triggered,
      });
    }
    return { resolved: true, persisted: true, deduped: false, triggered };
  });
}

/** Deps default (engine real). */
export function createSubmissionDeps(logger: Logger = createLogger('info')): SubmissionDeps {
  return { engine: { triggerFlow: engineTriggerFlow }, logger };
}

/**
 * Router de submissions. Expoe um endpoint interno para o despacho do webhook (e testes):
 * `POST /internal/flows/meta-submission` recebe o payload normalizado, processa e responde
 * 200 (ack rapido). A verificacao de assinatura/dedup do webhook fica no F1-S02; o gap-fill
 * do orchestrator chama `processMetaFlowSubmission` direto a partir do field handler.
 */
export function createFlowSubmissionsRouter(deps: SubmissionDeps = createSubmissionDeps()): Router {
  const router = Router();

  router.post('/internal/flows/meta-submission', async (req: Request, res: Response) => {
    const parsed = metaFlowSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    try {
      const result = await processMetaFlowSubmission(parsed.data, deps);
      res.status(200).json(result);
    } catch (err: unknown) {
      deps.logger.error('flow-submission: falha ao processar', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.sendStatus(500);
    }
  });

  return router;
}

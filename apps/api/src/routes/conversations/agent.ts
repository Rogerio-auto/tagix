/**
 * Troca manual do agente de IA que atende a conversa (F34-S04 /
 * AGENT_DEPARTMENT_ROUTING_PLAN D4).
 *
 * Endpoints:
 *  - GET  /api/conversations/:id/agent   — agente atual + candidatos elegíveis ao(s)
 *    departamento(s) da conversa. Mesma permissão `conversation.assign_agent`; alimenta
 *    o seletor do cockpit sem expandir o GET de detalhe (fora da fronteira do slot).
 *  - POST /api/conversations/:id/agent   — body `{ agentId }`. Fixa `agent_id`, garante
 *    `ai_mode='on'`, re-engaja (enfileira `flow.run.requested` em `hm.q.flows`) e emite
 *    `conversation:agent_changed`. AGENT só nas conversas atribuídas a ele.
 *
 * Padrão espelhado de `state.ts`: guard de visibilidade por-conversa
 * (`assertConversationVisible`) → 404 antes do 403 de escopo do AGENT (S07.1);
 * relay best-effort via `hm.q.socket.relay` DEPOIS da persistência commitada.
 *
 * Elegibilidade: o `agentId` precisa atender ALGUM departamento da conversa
 * (`conversations.department_id`). Conversa sem departamento → fallback: qualquer
 * agente ativo do workspace (não há dept para restringir; ver `eligibleAgents`).
 *
 * Re-engajamento: o worker de agentes (F2-S11) consome `hm.q.flows` e resolve o
 * `agent_id` já fixado na conversa — não precisamos passar o agente no envelope,
 * só o gatilho com o mesmo shape do inbound (`{ conversationId, contactId,
 * channelId, provider, triggerExternalId? }`).
 *
 * Router NÃO montado aqui — `app.ts` monta `createConversationAgentRouter()`.
 */
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { agentDepartmentsRepo, assertConversationVisible, schema, type DbTx } from '@hm/db';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import {
  CHANNEL_PROVIDERS,
  type ChannelProvider,
  type ConversationAgentChangedPayload,
  type Permission,
  type Role,
} from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;
/** Fila de gatilho de flow/agente (mesma de `apps/workers/src/inbound/db-ports.ts`). */
const FLOWS_QUEUE = 'hm.q.flows' as const;
/** Tipo do envelope de disparo (espelha `INBOUND_FLOW_TYPE` de F1-S26). */
const INBOUND_FLOW_TYPE = 'flow.run.requested' as const;
/** Permissão dedicada (D4). */
const ASSIGN_AGENT_PERM: Permission = 'conversation.assign_agent';

/** Narrowing do `req.params['id']` (Express 5 tipa como `string | string[]`). */
function paramId(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : '';
}

const assignSchema = z.object({
  agentId: z.string().uuid('agentId deve ser um UUID.'),
});

// ── Publisher MQ (canal AMQP lazy, compartilhado por processo) ────────────────
let handlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/** Publica `conversation:agent_changed` nas rooms da conversa + workspace. Best-effort. */
async function emitAgentChanged(
  workspaceId: string,
  conversationId: string,
  data: ConversationAgentChangedPayload,
): Promise<void> {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event: 'conversation:agent_changed',
    target: { conversationId, workspace: true },
    data,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

/**
 * Re-engaja a IA enfileirando `flow.run.requested` em `hm.q.flows` — mesmo contrato
 * do inbound. O worker de agentes resolve o `agent_id` já fixado. Best-effort: a troca
 * já está persistida quando o gatilho é publicado.
 */
async function enqueueReengage(
  workspaceId: string,
  trigger: { conversationId: string; contactId: string; channelId: string; provider: ChannelProvider },
): Promise<void> {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope(INBOUND_FLOW_TYPE, workspaceId, {
    conversationId: trigger.conversationId,
    contactId: trigger.contactId,
    channelId: trigger.channelId,
    provider: trigger.provider,
  });
  channel.sendToQueue(FLOWS_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
  await Promise.resolve();
}

/**
 * Escopo AGENT-só-nas-suas: OWNER/ADMIN/SUPERVISOR atuam em qualquer conversa visível
 * (visibilidade já garantida por `assertConversationVisible`); AGENT só nas atribuídas a
 * ele. READONLY já é barrado pela matriz `can()`.
 */
function agentScopeOk(role: string, assignedTo: string | null, memberId: string): boolean {
  if (role !== 'AGENT') return true;
  return assignedTo !== null && assignedTo === memberId;
}

interface AgentCandidate {
  id: string;
  name: string;
}

/**
 * Agentes elegíveis a atender a conversa: ativos no workspace E que atendem ALGUM
 * dos departamentos da conversa. Sem departamento → fallback para todos os agentes
 * ativos do workspace (não há dept para restringir). Sempre dentro da `tx` RLS.
 */
async function eligibleAgents(tx: DbTx, departmentId: string | null): Promise<AgentCandidate[]> {
  const activeAgents = await tx
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.status, 'active'));

  if (!departmentId) {
    // Fallback sem-dept (gotcha do slot): a conversa não tem departamento para
    // restringir, então qualquer agente ativo do workspace é elegível.
    return activeAgents;
  }

  const links = await agentDepartmentsRepo.listAgentsForDepartment(tx, departmentId);
  const eligibleIds = new Set(links.map((l) => l.agentId));
  return activeAgents.filter((a) => eligibleIds.has(a.id));
}

export function createConversationAgentRouter(): Router {
  const router = Router();

  // GET /api/conversations/:id/agent — agente atual + candidatos elegíveis.
  router.get(
    '/api/conversations/:id/agent',
    requireAuth,
    withRLS,
    requireRole(ASSIGN_AGENT_PERM),
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const role = req.auth!.member.role as Role;
      const memberId = req.auth!.member.id;
      const workspaceId = req.auth!.workspace.id;

      const result = await req.scoped!(async (tx) => {
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return { notFound: true } as const;
        }
        const [conversation] = await tx
          .select({
            assignedTo: schema.conversations.assignedTo,
            departmentId: schema.conversations.departmentId,
            agentId: schema.conversations.agentId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return { notFound: true } as const;
        if (!agentScopeOk(role, conversation.assignedTo, memberId)) {
          return { forbidden: true } as const;
        }

        const candidates = await eligibleAgents(tx, conversation.departmentId);
        let currentName: string | null = null;
        if (conversation.agentId) {
          currentName = candidates.find((c) => c.id === conversation.agentId)?.name ?? null;
          if (currentName === null) {
            const [row] = await tx
              .select({ name: schema.agents.name })
              .from(schema.agents)
              .where(eq(schema.agents.id, conversation.agentId))
              .limit(1);
            currentName = row?.name ?? null;
          }
        }
        return {
          ok: true as const,
          currentAgentId: conversation.agentId,
          currentAgentName: currentName,
          candidates,
        };
      });

      if ('notFound' in result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if ('forbidden' in result) {
        res.status(403).json({ message: 'Conversa não atribuída a você.' });
        return;
      }
      res.json({
        currentAgentId: result.currentAgentId,
        currentAgentName: result.currentAgentName,
        candidates: result.candidates,
      });
    },
  );

  // POST /api/conversations/:id/agent — troca manual do agente de IA.
  router.post(
    '/api/conversations/:id/agent',
    requireAuth,
    withRLS,
    requireRole(ASSIGN_AGENT_PERM),
    async (req: Request, res: Response): Promise<void> => {
      const conversationId = paramId(req, 'id');
      if (!conversationId) {
        res.status(400).json({ message: 'id ausente.' });
        return;
      }
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: 'agentId inválido.', issues: parsed.error.issues });
        return;
      }
      const { agentId } = parsed.data;
      const role = req.auth!.member.role as Role;
      const memberId = req.auth!.member.id;
      const workspaceId = req.auth!.workspace.id;
      const now = new Date();

      const result = await req.scoped!(async (tx) => {
        // 404 (não confirma existência) precede o 403 de escopo do AGENT (S07.1).
        if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
          return { notFound: true } as const;
        }
        const [conversation] = await tx
          .select({
            assignedTo: schema.conversations.assignedTo,
            departmentId: schema.conversations.departmentId,
            contactId: schema.conversations.contactId,
            channelId: schema.conversations.channelId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!conversation) return { notFound: true } as const;
        if (!agentScopeOk(role, conversation.assignedTo, memberId)) {
          return { forbidden: true } as const;
        }

        // Elegibilidade: o agente precisa existir, estar ativo no workspace (RLS) e
        // atender algum departamento da conversa (ou ser elegível por fallback sem-dept).
        const candidates = await eligibleAgents(tx, conversation.departmentId);
        const target = candidates.find((c) => c.id === agentId);
        if (!target) {
          return { ineligible: true } as const;
        }

        // Resolve o provider do canal para montar o gatilho de re-engajamento.
        const [channel] = await tx
          .select({ provider: schema.channels.provider })
          .from(schema.channels)
          .where(eq(schema.channels.id, conversation.channelId))
          .limit(1);

        await tx
          .update(schema.conversations)
          .set({
            agentId,
            // Troca de agente reativa a IA (handoff de volta à IA) e limpa pausa pendente.
            aiMode: 'on',
            aiPausedReason: null,
            aiPausedAt: null,
            aiPausedBy: null,
            aiResumeAt: null,
            updatedAt: now,
          })
          .where(eq(schema.conversations.id, conversationId));

        return {
          ok: true as const,
          agentName: target.name,
          contactId: conversation.contactId,
          channelId: conversation.channelId,
          provider: channel?.provider ?? null,
        };
      });

      if ('notFound' in result) {
        res.status(404).json({ message: 'Conversa não encontrada.' });
        return;
      }
      if ('forbidden' in result) {
        res.status(403).json({ message: 'Conversa não atribuída a você.' });
        return;
      }
      if ('ineligible' in result) {
        res.status(422).json({ message: 'Agente não elegível ao departamento da conversa.' });
        return;
      }

      const payload: ConversationAgentChangedPayload = {
        conversationId,
        agentId,
        agentName: result.agentName,
      };

      // Re-engajamento só dispara com gatilho válido (contact + provider conhecidos);
      // o worker de agentes exige `contactId`/`provider` no envelope.
      const canReengage =
        result.contactId !== null &&
        result.provider !== null &&
        (CHANNEL_PROVIDERS as readonly string[]).includes(result.provider);

      await Promise.allSettled([
        emitAgentChanged(workspaceId, conversationId, payload),
        ...(canReengage
          ? [
              enqueueReengage(workspaceId, {
                conversationId,
                contactId: result.contactId!,
                channelId: result.channelId,
                provider: result.provider as ChannelProvider,
              }),
            ]
          : []),
      ]);

      res.json({ conversationId, agentId });
    },
  );

  return router;
}

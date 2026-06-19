/**
 * Webhook AbacatePay (F41-S03 — PAYMENTS_ABACATEPAY.md §4/§9).
 *
 *   POST /webhooks/abacatepay?webhookSecret=… → auth → dedup → mapeia evento → transição
 *
 * **Fonte da verdade do pagamento.** Montado ANTES do `express.json()` global
 * (raw body): a verificação opcional de HMAC precisa dos bytes EXATOS recebidos —
 * um JSON re-serializado divergiria. Espelha o raw-body do webhook Meta.
 *
 * Segurança (§9):
 *  - AUTH PRIMÁRIA: o query param `webhookSecret` é comparado (constant-time) com
 *    `ABACATEPAY_WEBHOOK_SECRET`. Ausente/errado → 401, sem efeito (fail-closed).
 *  - CAMADA EXTRA (opcional): quando `ABACATEPAY_PUBLIC_KEY` está configurada,
 *    exigimos também o header `x-webhook-signature` = HMAC-SHA256(base64) do raw
 *    body com a chave pública da AbacatePay; mismatch → 401.
 *  - Idempotência dupla (borda em `webhook_events` + domínio em `payment_events`
 *    pelo `id` top-level do evento); preço/plano SEMPRE reconferidos server-side
 *    em `transitions.ts`; toda transição auditada. Nunca logamos secret/chave/payload.
 *
 * Secrets vêm de env (`ABACATEPAY_WEBHOOK_SECRET`, `ABACATEPAY_PUBLIC_KEY`),
 * nunca por-tenant, nunca commitados.
 */
import { Buffer } from 'node:buffer';
import express, { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, type DB } from '@hm/db';
import type { ChannelProvider } from '@hm/shared';
import {
  verifyWebhookSecret,
  verifyWebhookSignature,
  ABACATEPAY_SIGNATURE_HEADER,
  ABACATEPAY_WEBHOOK_SECRET_PARAM,
  WebhookEventSchema,
  type WebhookEvent,
} from '@hm/payments';
import { createLogger } from '@hm/logger';
import { deriveEventId } from './event-id';
import { registerWebhookEvent } from './dedup';
import {
  applyTransition,
  eventTypeOf,
  resolveExternalSubscriptionId,
  type SubscriptionStatus,
  type TransitionPorts,
} from '../../services/billing/transitions';

const PROVIDER = 'abacatepay' as const;
const webhookLogger = createLogger('info', { svc: 'abacatepay-webhook' });

function getRawBody(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Id de idempotência de domínio: o `id` top-level do envelope (`log_…`) ou, se
 * ausente, um hash determinístico do corpo (defensivo — não esperado na v2).
 */
function deriveDomainEventId(event: WebhookEvent, rawBody: Buffer): string {
  if (typeof event.id === 'string' && event.id.length > 0) return event.id;
  return deriveEventId(rawBody, event);
}

function coerceStatus(value: string): SubscriptionStatus | null {
  return value === 'active' || value === 'canceled' || value === 'past_due'
    ? value
    : null;
}

/**
 * Constrói as portas de persistência reais (Drizzle, owner-level). Roda na borda,
 * antes da resolução de tenant — `getDb()` bypassa RLS, mesma postura de
 * `webhook_events`/`payment_events`. Toda escrita é por workspace_id explícito.
 */
function buildPorts(db: DB): TransitionPorts {
  const { subscriptions, workspaces, plans, auditLogs } = schema;

  return {
    async findSubscriptionByExternalId(externalId) {
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.externalSubscriptionId, externalId))
        .limit(1);
      if (!row) return null;
      return {
        workspaceId: row.workspaceId,
        planId: row.planId,
        status: (coerceStatus(row.status) ?? 'trial') as SubscriptionStatus,
        currentPeriodEnd: row.currentPeriodEnd ?? null,
        paymentMethod: row.paymentMethod === 'card' || row.paymentMethod === 'pix' ? row.paymentMethod : null,
        billingCycle: row.billingCycle ?? null,
      };
    },
    async findSubscriptionByWorkspace(workspaceId) {
      const [row] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, workspaceId))
        .limit(1);
      if (!row) return null;
      return {
        workspaceId: row.workspaceId,
        planId: row.planId,
        status: (coerceStatus(row.status) ?? 'trial') as SubscriptionStatus,
        currentPeriodEnd: row.currentPeriodEnd ?? null,
        paymentMethod: row.paymentMethod === 'card' || row.paymentMethod === 'pix' ? row.paymentMethod : null,
        billingCycle: row.billingCycle ?? null,
      };
    },
    async getWorkspace(workspaceId) {
      const [row] = await db
        .select({
          id: workspaces.id,
          planId: workspaces.planId,
          status: workspaces.subscriptionStatus,
          trialEndsAt: workspaces.trialEndsAt,
        })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        planId: row.planId,
        status: (coerceStatus(row.status) ?? 'trial') as SubscriptionStatus,
        trialEndsAt: row.trialEndsAt ?? null,
      };
    },
    async isPlanActive(planId) {
      const [row] = await db
        .select({ isActive: plans.isActive })
        .from(plans)
        .where(eq(plans.id, planId))
        .limit(1);
      return row?.isActive === true;
    },
    async applyTransition({ workspaceId, patch, externalSubscriptionId }) {
      const now = new Date();
      // workspaces = fonte da verdade do status/plano/trial.
      await db
        .update(workspaces)
        .set({
          subscriptionStatus: patch.status,
          planId: patch.planId,
          trialEndsAt: patch.trialEndsAt,
          updatedAt: now,
        })
        .where(eq(workspaces.id, workspaceId));

      // subscriptions = espelho coerente (period/cancel/canceled). `subscriptions.plan_id`
      // é NOT NULL: só sobrescrevemos o plano quando resolvido (nunca para null).
      // `external_subscription_id` só é gravado quando o evento traz o `subs_…`
      // real (activate/renew) — o checkout só conhecia o `bill_…`; este é o id
      // necessário para o cancelamento de cartão (POST /subscriptions/cancel).
      await db
        .update(subscriptions)
        .set({
          status: patch.status,
          ...(patch.planId !== null ? { planId: patch.planId } : {}),
          ...(externalSubscriptionId !== null
            ? { externalSubscriptionId }
            : {}),
          trialEndsAt: patch.trialEndsAt,
          currentPeriodEnd: patch.currentPeriodEnd,
          canceledAt: patch.canceledAt,
          cancelAtPeriodEnd: patch.status === 'canceled',
          updatedAt: now,
        })
        .where(eq(subscriptions.workspaceId, workspaceId));
    },
    async recordAudit({ workspaceId, action, before, after, metadata }) {
      try {
        await db.insert(auditLogs).values({
          workspaceId,
          actorMemberId: null,
          actorType: 'system',
          action,
          resourceType: 'subscription',
          resourceId: workspaceId,
          metadata: { before, after, ...metadata },
        });
      } catch {
        // best-effort: a transição já foi aplicada; auditoria não deve derrubar o ack.
      }
    },
  };
}

/**
 * Grava o evento em `payment_events` de forma idempotente por (provider, event id)
 * e devolve `{ id, alreadyProcessed }`. Replay de um evento já processado é no-op.
 *
 * Owner-level (bypassa RLS), igual a `webhook_events`. Espelha a semântica do
 * `paymentEventsRepo.record` (S02) sem depender do seu wiring de export no barrel.
 */
async function recordPaymentEvent(
  db: DB,
  input: {
    externalEventId: string;
    eventType: string;
    rawPayload: Record<string, unknown>;
    subscriptionExternalId: string | null;
  },
): Promise<{ id: string; alreadyProcessed: boolean }> {
  const { paymentEvents } = schema;
  const [inserted] = await db
    .insert(paymentEvents)
    .values({
      provider: PROVIDER,
      externalEventId: input.externalEventId,
      eventType: input.eventType,
      rawPayload: input.rawPayload,
      subscriptionExternalId: input.subscriptionExternalId,
    })
    .onConflictDoNothing({
      target: [paymentEvents.provider, paymentEvents.externalEventId],
    })
    .returning({ id: paymentEvents.id });

  if (inserted) return { id: inserted.id, alreadyProcessed: false };

  const [existing] = await db
    .select({ id: paymentEvents.id, processedAt: paymentEvents.processedAt })
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.provider, PROVIDER),
        eq(paymentEvents.externalEventId, input.externalEventId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error('payment_events: insert idempotente sem linha resultante.');
  }
  return { id: existing.id, alreadyProcessed: existing.processedAt !== null };
}

export function createAbacatePayWebhookRouter(): Router {
  const router = Router();

  router.post(
    '/webhooks/abacatepay',
    express.raw({ type: () => true, limit: '1mb' }),
    async (req: Request, res: Response) => {
      const rawBody = getRawBody(req);

      // AUTH PRIMÁRIA (§9): a AbacatePay anexa o secret na query string do endpoint
      // registrado (`?webhookSecret=…`). Comparação constant-time com o env.
      // Ausente/errado → 401, sem efeito (fail-closed).
      const providedSecretRaw = req.query[ABACATEPAY_WEBHOOK_SECRET_PARAM];
      const providedSecret =
        typeof providedSecretRaw === 'string' ? providedSecretRaw : undefined;
      const expectedSecret = process.env['ABACATEPAY_WEBHOOK_SECRET'];
      if (!verifyWebhookSecret(providedSecret, expectedSecret)) {
        res.sendStatus(401);
        return;
      }

      // CAMADA EXTRA (opcional): só quando ABACATEPAY_PUBLIC_KEY está configurada,
      // exigimos o HMAC-SHA256(base64) do raw body no header `x-webhook-signature`,
      // com a chave pública da AbacatePay. Mismatch → 401.
      const publicKey = process.env['ABACATEPAY_PUBLIC_KEY'];
      if (publicKey && publicKey.length > 0) {
        const signature = req.get(ABACATEPAY_SIGNATURE_HEADER);
        if (!verifyWebhookSignature(rawBody, signature, publicKey)) {
          res.sendStatus(401);
          return;
        }
      }

      // Parse + validação Zod do corpo já autenticado.
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        // Corpo não-JSON com assinatura válida é anômalo → ack para evitar reentrega.
        res.sendStatus(200);
        return;
      }
      const result = WebhookEventSchema.safeParse(parsed);
      if (!result.success) {
        // Envelope inesperado mas assinado → ack idempotente, nada a transicionar.
        webhookLogger.warn('webhook.abacatepay.invalid_envelope');
        res.sendStatus(200);
        return;
      }
      const event = result.data;
      const rawPayload = isRecord(parsed) ? parsed : {};
      const eventType = eventTypeOf(event);
      const externalEventId = deriveDomainEventId(event, rawBody);
      const subscriptionExternalId = resolveExternalSubscriptionId(event);

      const db = getDb();

      // Dedup de BORDA (HTTP): replay do mesmo envelope não re-processa.
      const firstSeenAtEdge = await registerWebhookEvent({
        // webhook_events.provider é tipado como ChannelProvider; 'abacatepay' é um
        // provider de pagamento — coerção controlada (a coluna é text livre no DB).
        provider: PROVIDER as unknown as ChannelProvider,
        externalEventId,
        rawPayload,
      });

      // Dedup + ledger de DOMÍNIO: idempotência por (provider, event id).
      const ledger = await recordPaymentEvent(db, {
        externalEventId,
        eventType,
        rawPayload,
        subscriptionExternalId,
      });

      if (!firstSeenAtEdge || ledger.alreadyProcessed) {
        // Já visto/processado → no-op idempotente.
        res.sendStatus(200);
        return;
      }

      // Aplica a transição de domínio (status + audit) server-side.
      const ports = buildPorts(db);
      const outcome = await applyTransition(event, ports);

      if (outcome.kind === 'applied') {
        await db
          .update(schema.paymentEvents)
          .set({ processedAt: new Date(), workspaceId: outcome.workspaceId, status: outcome.status })
          .where(eq(schema.paymentEvents.id, ledger.id));
        webhookLogger.info('webhook.abacatepay.transition', {
          eventType,
          status: outcome.status,
        });
      } else {
        // Ignorado (evento não mapeado) ou não resolvido (sem assinatura nossa).
        // Carimba processed_at mesmo assim para não re-tentar em loop, mas registra o motivo.
        await db
          .update(schema.paymentEvents)
          .set({ processedAt: new Date() })
          .where(eq(schema.paymentEvents.id, ledger.id));
        webhookLogger.info('webhook.abacatepay.skipped', {
          eventType,
          outcome: outcome.kind,
          reason: outcome.reason,
        });
      }

      // Resposta rápida e idempotente.
      res.sendStatus(200);
    },
  );

  return router;
}

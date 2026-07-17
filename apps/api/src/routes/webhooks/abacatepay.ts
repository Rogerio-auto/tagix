/**
 * Webhook AbacatePay (F41-S03 — PAYMENTS_ABACATEPAY.md §4/§9).
 *
 *   POST /webhooks/abacatepay?webhookSecret=… → auth → dedup → mapeia evento → transição
 *
 * **Fonte da verdade do pagamento.** Montado ANTES do `express.json()` global
 * (raw body): a verificação opcional de HMAC precisa dos bytes EXATOS recebidos —
 * um JSON re-serializado divergiria. Espelha o raw-body do webhook Meta.
 *
 * Segurança (§9 + SEC-07):
 *  - AUTH PRIMÁRIA: o secret é comparado (constant-time) com
 *    `ABACATEPAY_WEBHOOK_SECRET`. Preferimos o header `x-webhook-secret` (não
 *    vaza na query) com fallback para o query param legado `?webhookSecret=…`.
 *    Ausente/errado → 401, sem efeito (fail-closed).
 *  - CAMADA HMAC: quando `ABACATEPAY_PUBLIC_KEY` está configurada exigimos o
 *    header `x-webhook-signature` = HMAC-SHA256(base64) do raw body com a chave
 *    pública; mismatch → 401. Em PRODUÇÃO essa camada é OBRIGATÓRIA: sem a chave
 *    configurada respondemos 503 (misconfiguração → retry), sem assinatura
 *    válida respondemos 401. A política vive em `authenticateAbacatePayWebhook`.
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

/**
 * Header PREFERIDO para o secret do webhook. Evita que o segredo trafegue na
 * query string (posição logável em access log / Sentry / Traefik). Quando
 * presente, tem precedência sobre o query param legado `?webhookSecret=…`.
 */
const ABACATEPAY_WEBHOOK_SECRET_HEADER = 'x-webhook-secret' as const;

/** Motivo estruturado de rejeição (para log/observabilidade, nunca ao cliente). */
type WebhookAuthRejection = 'secret_mismatch' | 'hmac_key_missing_in_prod' | 'hmac_invalid';

type WebhookAuthResult = { ok: true } | { ok: false; rejection: WebhookAuthRejection };

interface WebhookAuthInput {
  readonly rawBody: Buffer;
  readonly providedSecret: string | undefined;
  readonly signature: string | undefined;
  readonly expectedSecret: string | undefined;
  readonly publicKey: string | undefined;
  readonly isProduction: boolean;
}

/**
 * Decisão ÚNICA de autenticidade do webhook (SEC-07). Falha fechado:
 *
 *  1. Secret (header/query) tem de conferir com `ABACATEPAY_WEBHOOK_SECRET`.
 *  2. Em PRODUÇÃO o HMAC (`ABACATEPAY_PUBLIC_KEY`) é OBRIGATÓRIO:
 *     - sem chave configurada → `hmac_key_missing_in_prod` (misconfig → 503/retry);
 *     - com chave, a assinatura tem de conferir → senão `hmac_invalid` (401).
 *  3. Fora de produção o HMAC só é exigido quando a chave pública existe
 *     (defense-in-depth opcional), preservando o comportamento anterior em dev.
 *
 * A política de env vive aqui (camada de app); a camada `@hm/payments` só provê
 * os primitivos puros de comparação (`verifyWebhookSecret`/`verifyWebhookSignature`).
 */
function authenticateWebhook(input: WebhookAuthInput): WebhookAuthResult {
  if (!verifyWebhookSecret(input.providedSecret, input.expectedSecret)) {
    return { ok: false, rejection: 'secret_mismatch' };
  }

  const hasPublicKey = typeof input.publicKey === 'string' && input.publicKey.length > 0;

  if (input.isProduction && !hasPublicKey) {
    // Fail-closed: em produção o webhook de billing exige a camada HMAC.
    return { ok: false, rejection: 'hmac_key_missing_in_prod' };
  }

  const hmacRequired = input.isProduction || hasPublicKey;
  if (hmacRequired && !verifyWebhookSignature(input.rawBody, input.signature, input.publicKey)) {
    return { ok: false, rejection: 'hmac_invalid' };
  }

  return { ok: true };
}

/**
 * Redige o secret do webhook de uma URL/URL-com-query antes de logar. Substitui
 * o valor do query param `webhookSecret` por `***`. Idempotente e à prova de URL
 * relativa ou malformada (regex de fallback quando o parser falha).
 */
export function redactWebhookSecretFromUrl(url: string): string {
  const REDACTED = '***';
  try {
    const parsed = new URL(url, 'http://redact.local');
    if (!parsed.searchParams.has(ABACATEPAY_WEBHOOK_SECRET_PARAM)) return url;
    parsed.searchParams.set(ABACATEPAY_WEBHOOK_SECRET_PARAM, REDACTED);
    const isRelative = !/^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    return isRelative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    return url.replace(
      new RegExp(`([?&]${ABACATEPAY_WEBHOOK_SECRET_PARAM}=)[^&#]*`, 'gi'),
      `$1${REDACTED}`,
    );
  }
}

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

      // AUTH (SEC-07): o secret é aceito no HEADER `x-webhook-secret` (preferido,
      // não vaza na query string) com FALLBACK para o query param legado
      // `?webhookSecret=…`. Em PRODUÇÃO o HMAC (`ABACATEPAY_PUBLIC_KEY`) é
      // OBRIGATÓRIO — sem chave/assinatura válida, recusamos (fail-closed).
      const headerSecret = req.get(ABACATEPAY_WEBHOOK_SECRET_HEADER);
      const querySecretRaw = req.query[ABACATEPAY_WEBHOOK_SECRET_PARAM];
      const querySecret =
        typeof querySecretRaw === 'string' ? querySecretRaw : undefined;
      const providedSecret =
        headerSecret && headerSecret.length > 0 ? headerSecret : querySecret;

      const auth = authenticateWebhook({
        rawBody,
        providedSecret,
        signature: req.get(ABACATEPAY_SIGNATURE_HEADER),
        expectedSecret: process.env['ABACATEPAY_WEBHOOK_SECRET'],
        publicKey: process.env['ABACATEPAY_PUBLIC_KEY'],
        isProduction: process.env['NODE_ENV'] === 'production',
      });
      if (!auth.ok) {
        // Nunca logamos secret/assinatura/URL crua — a query é sempre redigida.
        webhookLogger.warn('webhook.abacatepay.auth_rejected', {
          reason: auth.rejection,
          url: redactWebhookSecretFromUrl(req.originalUrl),
        });
        // Chave HMAC ausente em produção = misconfiguração nossa → 503 (retry);
        // qualquer outra falha de autenticidade → 401 (fail-closed).
        res.sendStatus(auth.rejection === 'hmac_key_missing_in_prod' ? 503 : 401);
        return;
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

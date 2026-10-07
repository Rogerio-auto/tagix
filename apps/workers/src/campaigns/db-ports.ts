/**
 * Implementacao das CampaignTickPorts contra @hm/db + RLS (CAMPAIGNS.md 8).
 *
 * enqueueDelivery e o coracao da maquina de estados do recipient — TUDO numa
 * unica transacao RLS-escopada (withWorkspace = BEGIN + set local role):
 *
 *   1. CLAIM ATOMICO: UPDATE ... SET status='sending' WHERE status='pending'
 *      AND next_step_at devido. Zero linhas => outro tick levou o recipient
 *      (outcome `skipped`). Espelha o claim de scheduled_followups (followups.ts).
 *   2. IDEMPOTENCIA: insere campaign_deliveries com idempotencyKey UNIQUE;
 *      conflito => o step JA foi despachado antes -> NAO reenvia, mas AVANCA o
 *      recipient (cura a linha que ficaria presa se um crash matasse o processo
 *      entre o envio e a transicao).
 *   3. DRIP (CAMP-03): `advanceAfterDispatch` devolve o recipient a `pending`
 *      com next_step_at = now + delaySeconds do PROXIMO step — ou o marca
 *      `completed` quando os steps acabam (CAMP-04).
 *
 * F70-S16 — o job de outbound (hm.q.outbound) e o `conversation.opened` vao pela
 * OUTBOX, gravados NA transacao do disparo (nessa ordem: a conversa e anunciada
 * antes da mensagem dela sair). Commit = delivery, mensagem, evento e job juntos;
 * rollback = nada (nenhum job aponta para uma mensagem que nunca existiu). O relay
 * dos workers publica com publisher confirms; queda do processo depois do commit
 * nao deixa delivery `queued` sem job. A compensacao pos-commit da F70-S14 deixou
 * de existir: nao ha mais publicacao que possa falhar depois do commit.
 *
 * O que era o bug: o recipient virava `sending` e ninguem o tirava de la;
 * `delaySeconds` nunca era lido; a campanha nunca chegava a `completed`; e o
 * teto diario (`daily_limit`/`messages_sent_today`) existia so no schema.
 *
 * F58-S12: antes de gravar, o modelo do passo passa pelo catalogo sincronizado (pausado/
 * recusado => nenhum job, campanha pausada com orientacao) e as variaveis sao resolvidas
 * com os dados DO contato (`campaigns/outbox/bindings.ts`): o job ja nasce com os
 * componentes da Graph daquele destinatario. Pausa/cancelamento posteriores seguram o que
 * ainda nao saiu da outbox (trigger `campaign_outbox_gate`, migracao 0095).
 *
 * F70-S13: conversa que o disparo ABRIU anuncia `conversation.opened` (construtor do
 * catalogo, eventId canonico `<conversa>:opened`). A criacao e upsert por
 * `(channel_id, remote_id)`: o perdedor de uma corrida com o inbound reusa a
 * conversa vencedora e nao anuncia nada; rollback nao anuncia nada.
 */
import { and, asc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { consentRepo, decryptSecret, enqueueOutbox, getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { GraphClient, MetaError, fetchChannelQuality, type ChannelHealth } from '@hm/channels';
import { decideOutbound, isMarketCode } from '@hm/shared';
import type { ChannelKind, MarketCode, OutboundDecision } from '@hm/shared';
import {
  domainEvents,
  domainEventsOutbox,
  makeEnvelope,
  queueJobOutbox,
  QUEUES,
} from '@hm/shared/mq';
import type { Envelope, MqHandle, OutboxMessage } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type { CampaignErrorAction } from '@hm/channels';
import {
  describeStopReason,
  type CampaignQuota,
  type CampaignTickPorts,
  type ChannelInspection,
  type CloseResult,
  type DispatchOutcome,
  type DispatchPacing,
  type PendingDispatch,
  type PromotedCampaign,
  type ReapResult,
  type RunningCampaign,
} from './tick';
import { decideDispatchGate, type DispatchGateDecision } from './rate';
import type { SendWindows } from './windows';
import { subscriptionGate, type SubscriptionGate } from '../lib/subscription-gate';
import {
  TEMPLATE_PAUSE_GUIDANCE,
  catalogBlockReason,
  renderRecipientComponents,
  type TemplatePauseReason,
} from './outbox';
import {
  advanceAfterDispatch,
  afterDispatchFailure,
  campaignIsExhausted,
  evaluateDailyQuota,
  MAX_DISPATCH_ATTEMPTS,
  STALE_CLAIM_MS,
  type CampaignStepRef,
  type RecipientTransition,
} from './steps/state';

type MqChannel = MqHandle['channel'];

const {
  campaigns,
  campaignSteps,
  campaignRecipients,
  campaignDeliveries,
  channels,
  channelSecrets,
  channelMessageTemplates,
  contacts,
  conversations,
  messages,
  auditLogs,
} = schema;

export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

export interface CampaignDbDeps {
  /** Canal AMQP do processo (o disparo em si nao publica mais: vai pela outbox). */
  readonly channel: MqChannel;
  readonly logger: Logger;
  readonly graph?: GraphClient;
  /** Portão de assinatura (F71-S06). Default: lê `workspaces` a cada tick da campanha. */
  readonly subscription?: SubscriptionGate;
}

/**
 * Resultado do disparo + o que ele deixa para a outbox, na MESMA transacao: a
 * conversa que abriu (anunciada) e o envelope do job de outbound.
 */
interface DispatchTx {
  readonly outcome: DispatchOutcome;
  readonly opened: { readonly conversationId: string; readonly contactId: string } | null;
  readonly job: Envelope | null;
}

/** Mensagens da outbox de um disparo, na ordem: a conversa abre antes da mensagem sair. */
function dispatchOutbox(campaign: RunningCampaign, done: DispatchTx): OutboxMessage[] {
  const out: OutboxMessage[] = [];
  if (done.opened !== null) {
    out.push(
      ...domainEventsOutbox([
        domainEvents.conversationOpened(campaign.workspaceId, {
          conversationId: done.opened.conversationId,
          contactId: done.opened.contactId,
          channelId: campaign.channelId,
          trigger: 'campaign',
        }),
      ]),
    );
  }
  if (done.job !== null) out.push(queueJobOutbox(OUTBOUND_QUEUE, done.job));
  return out;
}

const settled = (outcome: DispatchOutcome): DispatchTx => ({ outcome, opened: null, job: null });

/** Steps da campanha na ordem de posicao (o indice do array = indice do passo). */
async function loadSteps(tx: DbTx, campaignId: string): Promise<CampaignStepRef[]> {
  const rows = await tx
    .select({
      id: campaignSteps.id,
      position: campaignSteps.position,
      delaySeconds: campaignSteps.delaySeconds,
    })
    .from(campaignSteps)
    .where(eq(campaignSteps.campaignId, campaignId))
    .orderBy(asc(campaignSteps.position));
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    delaySeconds: r.delaySeconds,
  }));
}

/** Aplica a transicao pos-dispatch (drip ou terminal) no recipient. */
async function applyTransition(
  tx: DbTx,
  recipientId: string,
  t: RecipientTransition,
): Promise<void> {
  await tx
    .update(campaignRecipients)
    .set({
      status: t.status,
      lastStepIndex: t.lastStepIndex,
      lastStepAt: t.lastStepAt,
      nextStepAt: t.nextStepAt,
      completedAt: t.completedAt,
      attempts: t.attempts,
    })
    .where(eq(campaignRecipients.id, recipientId));
}

/** Recipient com dado inviavel (sem telefone, step sumido): terminal `failed`. */
async function failRecipient(tx: DbTx, recipientId: string, reason: string): Promise<void> {
  await tx
    .update(campaignRecipients)
    .set({ status: 'failed', failedReason: reason, nextStepAt: null })
    .where(eq(campaignRecipients.id, recipientId));
}

/** SQL do "recipient esta devido agora" (next_step_at nulo = devido). */
function isDue(now: Date) {
  return or(isNull(campaignRecipients.nextStepAt), lte(campaignRecipients.nextStepAt, now));
}

/**
 * Desfaz a transacao inteira devolvendo um valor (o `withWorkspace` faz rollback
 * em qualquer throw). Usado quando o portao da campanha recusa a mensagem DEPOIS
 * do claim: claim, delivery e mensagem somem juntos.
 */
class TxAbort<T> extends Error {
  constructor(readonly value: T) {
    super('campaign tx abort');
    this.name = 'TxAbort';
  }
}

/**
 * F58-S12: o modelo de mensagem do passo nao pode sair (catalogo diz pausado/recusado,
 * ou as variaveis nao batem com o modelo). Desfaz o disparo inteiro; quem pega pausa a
 * campanha com o motivo, numa transacao propria.
 */
class TemplateBlocked extends Error {
  constructor(
    readonly reason: TemplatePauseReason,
    readonly detail: readonly string[],
    readonly templateName: string | null,
  ) {
    super(`campaign template blocked: ${reason}`);
    this.name = 'TemplateBlocked';
  }
}

/** Acoes de ciclo de vida gravadas em `audit_logs` (motivo observavel). */
type CampaignStatusAction = 'campaign.started' | 'campaign.paused' | 'campaign.completed';

/**
 * F58-S11: registra a mudanca de status com motivo + orientacao legivel. A API
 * devolve o ultimo registro no detalhe da campanha (`statusReason`).
 */
async function recordStatusChange(
  tx: DbTx,
  args: {
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly action: CampaignStatusAction;
    readonly reason: string;
    /** Orientacao propria do motivo (default: `describeStopReason`). */
    readonly message?: string;
    readonly extra?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    workspaceId: args.workspaceId,
    actorType: 'system',
    action: args.action,
    resourceType: 'campaign',
    resourceId: args.campaignId,
    metadata: {
      reason: args.reason,
      message: args.message ?? describeStopReason(args.reason),
      ...args.extra,
    },
  });
}

/**
 * F58-S12: pausa por modelo de mensagem (so se `running`), com motivo + orientacao. O
 * UPDATE de status dispara o trigger `campaign_outbox_gate`, que retem na mesma
 * transacao os jobs da campanha ainda nao publicados.
 */
async function pauseForTemplate(
  campaign: RunningCampaign,
  blocked: TemplateBlocked,
  now: Date,
): Promise<boolean> {
  return withWorkspace(campaign.workspaceId, async (tx) => {
    const updated = await tx
      .update(campaigns)
      .set({ status: 'paused', nextTickAt: null, updatedAt: now })
      .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'running')))
      .returning({ id: campaigns.id });
    if (updated.length === 0) return false;
    await recordStatusChange(tx, {
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      action: 'campaign.paused',
      reason: blocked.reason,
      message: TEMPLATE_PAUSE_GUIDANCE[blocked.reason],
      extra: { templateName: blocked.templateName, detail: [...blocked.detail] },
    });
    return true;
  });
}

/** Quality do numero muda devagar: 1 leitura da Graph por canal por minuto basta. */
export const QUALITY_CACHE_TTL_MS = 60_000;

/** Codigos Graph de credencial recusada (token invalido/expirado, sem permissao). */
const CREDENTIAL_ERROR_CODES: ReadonlySet<number> = new Set([190, 10, 200]);

/** true se o erro da Graph significa "reconecte o canal" (nao "tente mais tarde"). */
export function isCredentialError(err: unknown): boolean {
  if (!(err instanceof MetaError)) return false;
  if (err.code !== undefined && CREDENTIAL_ERROR_CODES.has(err.code)) return true;
  return err.httpStatus === 401 || err.httpStatus === 403;
}

/** Credenciais lidas do banco para consultar a Graph (fora da transacao). */
type ChannelCredentials =
  | { readonly kind: 'meta'; readonly phoneNumberId: string; readonly accessToken: string }
  | { readonly kind: 'not_meta' }
  | Extract<ChannelInspection, { kind: 'blocked' }>;

export function createCampaignTickPorts(deps: CampaignDbDeps): CampaignTickPorts {
  const graph = deps.graph ?? new GraphClient();

  const subscription = deps.subscription ?? subscriptionGate;
  /** Cache de quality por canal (por processo; a Graph nao e consultada a cada 5s). */
  const qualityCache = new Map<string, { health: ChannelHealth; expiresAt: number }>();

  return {
    async checkSubscription(campaign: RunningCampaign) {
      return subscription.check(campaign.workspaceId);
    },

    /**
     * F58-S11: `scheduled -> running` quando start_at vence. UPDATE condicional
     * unico (WHERE status='scheduled'): sob concorrencia, a segunda instancia
     * re-avalia a linha depois do lock e nao a ve mais como agendada — cada
     * campanha e promovida (e auditada) exatamente uma vez. Cross-tenant, como a
     * listagem do tick; o motivo vai para audit_logs na mesma transacao.
     */
    async promoteScheduledCampaigns(now: Date): Promise<PromotedCampaign[]> {
      return getDb().transaction(async (tx) => {
        const rows = await tx
          .update(campaigns)
          .set({ status: 'running', nextTickAt: now, updatedAt: now })
          .where(
            and(
              eq(campaigns.status, 'scheduled'),
              isNotNull(campaigns.startAt),
              lte(campaigns.startAt, now),
            ),
          )
          .returning({
            id: campaigns.id,
            workspaceId: campaigns.workspaceId,
            startAt: campaigns.startAt,
          });
        const out: PromotedCampaign[] = [];
        for (const r of rows) {
          const startAt = r.startAt ?? now;
          await recordStatusChange(tx, {
            workspaceId: r.workspaceId,
            campaignId: r.id,
            action: 'campaign.started',
            reason: 'start_at_reached',
            extra: { startAt: startAt.toISOString() },
          });
          out.push({ id: r.id, workspaceId: r.workspaceId, startAt });
        }
        return out;
      });
    },

    async listDueCampaigns(now: Date): Promise<RunningCampaign[]> {
      // Uma consulta so (antes: 1 + N para as metricas) — a varredura agora e a cada 5s.
      const rows = await getDb()
        .select({
          id: campaigns.id,
          workspaceId: campaigns.workspaceId,
          channelId: campaigns.channelId,
          sendWindows: campaigns.sendWindows,
          rateLimitPerMinute: campaigns.rateLimitPerMinute,
          endAt: campaigns.endAt,
          nextTickAt: campaigns.nextTickAt,
          deliveryRate: schema.campaignMetrics.deliveryRate,
        })
        .from(campaigns)
        .leftJoin(schema.campaignMetrics, eq(schema.campaignMetrics.campaignId, campaigns.id))
        .where(
          and(
            eq(campaigns.status, 'running'),
            or(isNull(campaigns.nextTickAt), lte(campaigns.nextTickAt, now)),
          ),
        )
        .orderBy(asc(sql`coalesce(${campaigns.nextTickAt}, '-infinity'::timestamptz)`));

      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspaceId,
        channelId: r.channelId,
        sendWindows: r.sendWindows as SendWindows | null,
        rateLimitPerMinute: r.rateLimitPerMinute,
        deliveryRate: r.deliveryRate != null ? Number(r.deliveryRate) : null,
        endAt: r.endAt,
        nextTickAt: r.nextTickAt,
      }));
    },

    /**
     * F58-S11: canal ativo + credencial + quality. As credenciais saem do banco
     * numa transacao curta; a chamada HTTP a Graph acontece FORA dela (nunca
     * segurar conexao do pool esperando rede). Quality fica em cache por canal.
     */
    async inspectChannel(campaign: RunningCampaign): Promise<ChannelInspection> {
      const creds = await withWorkspace(
        campaign.workspaceId,
        async (tx): Promise<ChannelCredentials> => {
          const [channel] = await tx
            .select({
              provider: channels.provider,
              isActive: channels.isActive,
              phoneNumberId: channels.phoneNumberId,
            })
            .from(channels)
            .where(eq(channels.id, campaign.channelId));
          if (!channel) return { kind: 'blocked', reason: 'channel_not_found' };
          if (!channel.isActive) return { kind: 'blocked', reason: 'channel_inactive' };
          if (channel.provider !== 'meta_whatsapp') return { kind: 'not_meta' };
          if (!channel.phoneNumberId) {
            return { kind: 'blocked', reason: 'channel_credentials_missing' };
          }
          const [secret] = await tx
            .select()
            .from(channelSecrets)
            .where(eq(channelSecrets.channelId, campaign.channelId));
          if (!secret) return { kind: 'blocked', reason: 'channel_credentials_missing' };
          let accessToken: string;
          try {
            accessToken = decryptSecret(secret.accessTokenEnc, secret.keyVersion);
          } catch {
            // Segredo ilegivel (chave rotacionada/corrompido): so reconectar resolve.
            return { kind: 'blocked', reason: 'channel_credentials_invalid' };
          }
          if (accessToken.length === 0) {
            return { kind: 'blocked', reason: 'channel_credentials_missing' };
          }
          return { kind: 'meta', phoneNumberId: channel.phoneNumberId, accessToken };
        },
      );

      if (creds.kind === 'blocked') return creds;
      if (creds.kind === 'not_meta') {
        // WAHA e afins nao tem quality rating: o ritmo configurado vale como esta.
        return { kind: 'ready', health: { qualityRating: 'UNKNOWN', tierLimit: 250 } };
      }

      const nowMs = Date.now();
      const cached = qualityCache.get(campaign.channelId);
      if (cached && cached.expiresAt > nowMs) return { kind: 'ready', health: cached.health };

      try {
        const health = await fetchChannelQuality(graph, {
          phoneNumberId: creds.phoneNumberId,
          accessToken: creds.accessToken,
        });
        qualityCache.set(campaign.channelId, {
          health,
          expiresAt: nowMs + QUALITY_CACHE_TTL_MS,
        });
        return { kind: 'ready', health };
      } catch (err: unknown) {
        qualityCache.delete(campaign.channelId);
        if (isCredentialError(err)) {
          return { kind: 'blocked', reason: 'channel_credentials_invalid' };
        }
        return {
          kind: 'unavailable',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async reapRecipients(campaign: RunningCampaign, now: Date): Promise<ReapResult> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
        const staleClaim = and(
          eq(campaignRecipients.campaignId, campaign.id),
          eq(campaignRecipients.status, 'sending'),
          // Date dentro de fragmento `sql` cru nao tem type-mapper no postgres.js
          // (ERR_INVALID_ARG_TYPE): manda ISO + cast explicito.
          sql`coalesce(${campaignRecipients.lastStepAt}, ${campaignRecipients.createdAt}) < ${cutoff.toISOString()}::timestamptz`,
        );

        // (a) claim estagnado que ja esgotou as tentativas -> falha honesta.
        const exhausted = await tx
          .update(campaignRecipients)
          .set({
            status: 'failed',
            failedReason: 'max_dispatch_attempts',
            nextStepAt: null,
          })
          .where(and(staleClaim, gte(campaignRecipients.attempts, MAX_DISPATCH_ATTEMPTS)))
          .returning({ id: campaignRecipients.id });

        // (b) demais claims estagnados voltam a fila (devidos agora).
        const recovered = await tx
          .update(campaignRecipients)
          .set({ status: 'pending', nextStepAt: now })
          .where(staleClaim)
          .returning({ id: campaignRecipients.id });

        // (c) CAMP-04: pendente que ja consumiu todos os steps -> terminal.
        const steps = await loadSteps(tx, campaign.id);
        const finalized = await tx
          .update(campaignRecipients)
          .set({ status: 'completed', completedAt: now, nextStepAt: null })
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.status, 'pending'),
              sql`coalesce(${campaignRecipients.lastStepIndex}, -1) + 1 >= ${steps.length}`,
            ),
          )
          .returning({ id: campaignRecipients.id });

        return {
          recovered: exhausted.length + recovered.length,
          finalized: finalized.length,
        };
      });
    },

    /**
     * Saldo do teto diario — SOMENTE leitura (F58-S11). O reset por virada de dia
     * e a contagem acontecem atomicamente na reserva de cada dispatch (lock de
     * linha); um reset aqui, baseado numa leitura sem lock, podia zerar envios
     * que outra instancia acabara de contar e furar o teto.
     */
    async ensureDailyQuota(campaign: RunningCampaign, now: Date): Promise<CampaignQuota> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const rows = await tx
          .select({
            dailyLimit: campaigns.dailyLimit,
            messagesSentToday: campaigns.messagesSentToday,
            lastDailyResetAt: campaigns.lastDailyResetAt,
            timezone: campaigns.timezone,
          })
          .from(campaigns)
          .where(eq(campaigns.id, campaign.id));
        const row = rows[0];
        if (!row) {
          // Campanha sumiu no meio do tick: nada a enviar.
          return { remaining: 0, resetsAt: new Date(now.getTime() + 60 * 60 * 1000) };
        }
        const quota = evaluateDailyQuota(
          {
            dailyLimit: row.dailyLimit,
            messagesSentToday: row.messagesSentToday,
            lastDailyResetAt: row.lastDailyResetAt,
            timezone: row.timezone,
          },
          now,
        );
        return { remaining: quota.remaining, resetsAt: quota.resetsAt };
      });
    },

    async pendingRecipients(
      campaign: RunningCampaign,
      limit: number,
      now: Date,
    ): Promise<PendingDispatch[]> {
      if (limit <= 0) return [];
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const recipients = await tx
          .select({
            recipientId: campaignRecipients.id,
            contactId: campaignRecipients.contactId,
            lastStepIndex: campaignRecipients.lastStepIndex,
          })
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.status, 'pending'),
              isDue(now),
            ),
          )
          .orderBy(
            asc(
              sql`coalesce(${campaignRecipients.nextStepAt}, ${campaignRecipients.createdAt})`,
            ),
          )
          .limit(limit);

        const steps = await loadSteps(tx, campaign.id);

        const out: PendingDispatch[] = [];
        for (const r of recipients) {
          const nextIdx = (r.lastStepIndex ?? -1) + 1;
          const step = steps[nextIdx];
          // Sem proximo step: o reaper (c) fecha esse recipient no proprio tick.
          if (!step) continue;
          out.push({
            recipientId: r.recipientId,
            contactId: r.contactId,
            stepId: step.id,
            stepIndex: nextIdx,
          });
        }
        return out;
      });
    },

    /**
     * F59-S05 — portao de consentimento antes de enfileirar.
     *
     * Campanha e sempre `marketing`: e o produtor que carrega a exigencia de
     * consentimento (AGENCIA_PLAN §4.4). Checar aqui evita enfileirar mil
     * mensagens que seriam recusadas uma a uma no worker outbound.
     */
    async checkConsent(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      now: Date,
    ): Promise<OutboundDecision> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const [canal] = await tx
          .select({ provider: channels.provider })
          .from(channels)
          .where(eq(channels.id, campaign.channelId))
          .limit(1);

        const [ws] = await tx
          .select({ market: schema.workspaces.market })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, campaign.workspaceId))
          .limit(1);

        const [contato] = await tx
          .select({ timezone: schema.contacts.timezone })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, dispatch.contactId))
          .limit(1);

        if (!canal || !ws || !contato) {
          return {
            allowed: false,
            reason: 'suppressed',
            message: 'Canal, workspace ou contato nao encontrado — envio recusado por seguranca.',
            usedFallbackTimezone: true,
            timezone: 'UTC',
          } satisfies OutboundDecision;
        }

        const market: MarketCode = isMarketCode(ws.market) ? ws.market : 'BR';
        const channel = canal.provider as ChannelKind;

        const consent = await consentRepo.getSnapshot(tx, {
          workspaceId: campaign.workspaceId,
          contactId: dispatch.contactId,
          channel,
          purpose: 'marketing',
        });

        return decideOutbound({
          market,
          channel,
          purpose: 'marketing',
          consent,
          contactTimezone: contato.timezone ?? null,
          // Canais de campanha de hoje (Meta/WAHA) nao exigem registro externo.
          // Quando o SMS entrar (F60-F), este valor vem do estado do canal.
          channelRegistration: 'none',
          now,
        });
      });
    },

    /**
     * F59-S05 — tira o recipient da execucao por supressao/falta de consentimento.
     * Distinto de `invalid` (dado ruim): aqui o dado esta certo e a pessoa
     * simplesmente nao pode receber. Reusa o mesmo caminho de `failed` para que
     * o motivo apareca no relatorio da campanha.
     */
    async denyRecipient(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      reason: string,
    ): Promise<void> {
      await withWorkspace(campaign.workspaceId, async (tx) => {
        await failRecipient(tx, dispatch.recipientId, `consent_${reason}`);
      });
    },

    /**
     * F58-S11 — janela horaria do contato: o recipient sai da frente da fila ate
     * `until` (continua `pending`). Antes ele voltava a cada tick e, com poucos
     * creditos, podia ocupar o lote inteiro e travar os demais.
     */
    async deferRecipient(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      until: Date,
    ): Promise<void> {
      await withWorkspace(campaign.workspaceId, (tx) =>
        tx
          .update(campaignRecipients)
          .set({ nextStepAt: until })
          .where(
            and(
              eq(campaignRecipients.id, dispatch.recipientId),
              eq(campaignRecipients.status, 'pending'),
            ),
          ),
      );
    },

    async enqueueDelivery(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      idempotencyKey: string,
      now: Date,
      pacing: DispatchPacing,
    ): Promise<DispatchOutcome> {
      const dispatchInTx = async (tx: DbTx): Promise<DispatchTx> => {
        // (1) Claim atomico: so avanca quem ainda esta pending E devido.
        const claimed = await tx
          .update(campaignRecipients)
          .set({
            status: 'sending',
            attempts: sql`${campaignRecipients.attempts} + 1`,
          })
          .where(
            and(
              eq(campaignRecipients.id, dispatch.recipientId),
              eq(campaignRecipients.status, 'pending'),
              isDue(now),
            ),
          )
          .returning({ attempts: campaignRecipients.attempts });
        const claim = claimed[0];
        if (!claim) return settled({ kind: 'skipped' });
        const attempts = claim.attempts;

        const steps = await loadSteps(tx, campaign.id);

        const [step] = await tx
          .select()
          .from(campaignSteps)
          .where(eq(campaignSteps.id, dispatch.stepId));
        if (!step) {
          await failRecipient(tx, dispatch.recipientId, 'step_missing');
          return settled({ kind: 'invalid', reason: 'step_missing' });
        }

        const [contact] = await tx
          .select({
            phone: contacts.phone,
            displayName: contacts.displayName,
            email: contacts.email,
            customFields: contacts.customFields,
          })
          .from(contacts)
          .where(eq(contacts.id, dispatch.contactId));
        if (!contact || !contact.phone) {
          await failRecipient(tx, dispatch.recipientId, 'missing_phone');
          return settled({ kind: 'invalid', reason: 'missing_phone' });
        }
        const phone = contact.phone;

        // F58-S12 — modelo e variaveis ANTES de qualquer gravacao. (a) O catalogo
        // sincronizado diz que a Meta nao aceita mais o modelo: nenhum job sai e a
        // campanha pausa com orientacao. (b) As variaveis viram componentes da Graph com
        // os dados DESTE contato (fallback obrigatorio); o job ja nasce resolvido.
        const [catalog] =
          step.templateName === null
            ? []
            : await tx
                .select({
                  status: channelMessageTemplates.status,
                  isAvailable: channelMessageTemplates.isAvailable,
                  components: channelMessageTemplates.components,
                })
                .from(channelMessageTemplates)
                .where(
                  and(
                    eq(channelMessageTemplates.channelId, campaign.channelId),
                    eq(channelMessageTemplates.name, step.templateName),
                    eq(channelMessageTemplates.language, step.languageCode),
                  ),
                )
                .limit(1);
        const blockedBy = catalogBlockReason(catalog ?? null);
        if (blockedBy !== null) {
          throw new TemplateBlocked(blockedBy, [catalog?.status ?? ''], step.templateName);
        }
        const rendered = renderRecipientComponents({
          stepComponents: step.templateComponents,
          catalogComponents: catalog?.components ?? null,
          contact: {
            displayName: contact.displayName,
            phone: contact.phone,
            email: contact.email,
            customFields: contact.customFields,
          },
        });
        if (!rendered.ok) {
          throw new TemplateBlocked(rendered.reason, rendered.detail, step.templateName);
        }

        // (2) Idempotencia: a UNIQUE decide se este step ja saiu alguma vez.
        const inserted = await tx
          .insert(campaignDeliveries)
          .values({
            workspaceId: campaign.workspaceId,
            campaignId: campaign.id,
            recipientId: dispatch.recipientId,
            stepId: dispatch.stepId,
            idempotencyKey,
            status: 'queued',
          })
          .onConflictDoNothing({ target: campaignDeliveries.idempotencyKey })
          .returning({ id: campaignDeliveries.id });
        const insertedRow = inserted[0];
        if (!insertedRow) {
          // Step ja despachado: NAO reenvia, mas destrava o recipient (avanca o
          // drip) — senao ele voltaria eternamente ao mesmo passo.
          await applyTransition(
            tx,
            dispatch.recipientId,
            advanceAfterDispatch(steps, dispatch.stepIndex, now),
          );
          return settled({ kind: 'duplicate' });
        }
        const deliveryId = insertedRow.id;

        const [existingConv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.channelId, campaign.channelId),
              eq(conversations.remoteId, phone),
            ),
          );
        let conversationId: string;
        let opened: DispatchTx['opened'] = null;
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          // Upsert: o inbound pode criar a mesma conversa ao mesmo tempo (o contato
          // escreveu). Sem o ON CONFLICT a UNIQUE derrubaria o disparo inteiro.
          const convRows = await tx
            .insert(conversations)
            .values({
              workspaceId: campaign.workspaceId,
              channelId: campaign.channelId,
              contactId: dispatch.contactId,
              remoteId: phone,
              status: 'open',
            })
            .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
            .returning({ id: conversations.id });
          const conv = convRows[0];
          if (conv) {
            conversationId = conv.id;
            opened = { conversationId: conv.id, contactId: dispatch.contactId };
          } else {
            const [winner] = await tx
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.channelId, campaign.channelId),
                  eq(conversations.remoteId, phone),
                ),
              );
            if (!winner) {
              await applyFailure(tx, dispatch.recipientId, attempts, now, 'conversation_failed');
              return settled({ kind: 'error', errorCode: '131008' });
            }
            conversationId = winner.id;
          }
        }

        const messageRows = await tx
          .insert(messages)
          .values({
            workspaceId: campaign.workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'system',
            type: 'template',
            content: step.templateName,
            viewStatus: 'pending',
            metadata: { campaignId: campaign.id, deliveryId },
          })
          .returning({ id: messages.id });
        const message = messageRows[0];
        if (!message) {
          await applyFailure(tx, dispatch.recipientId, attempts, now, 'message_failed');
          // A conversa criada acima commita junto com a falha: continua anunciada.
          return { outcome: { kind: 'error', errorCode: '131008' }, opened, job: null };
        }
        const messageId = message.id;

        await tx
          .update(campaignDeliveries)
          .set({ messageId })
          .where(eq(campaignDeliveries.id, deliveryId));

        // (3) Drip: proximo step agendado em now + delaySeconds (ou terminal).
        const applied = advanceAfterDispatch(steps, dispatch.stepIndex, now);
        await applyTransition(tx, dispatch.recipientId, applied);

        // (4) F58-S11 — portao da campanha, sob lock de linha, por ULTIMO (lock da
        // campanha seguro pelo menor tempo possivel; ordem recipient -> campanha,
        // a mesma do resume e do encerramento). Recusa => rollback de tudo acima.
        const gate = await reserveDispatch(tx, campaign.id, now, pacing);
        if (gate.kind === 'closed') {
          throw new TxAbort<DispatchOutcome>({
            kind: 'gate_closed',
            reason: gate.reason,
            retryAt: gate.retryAt,
          });
        }

        const job = {
          kind: 'template',
          channelId: campaign.channelId,
          conversationId,
          messageId,
          chatId: phone,
          templateName: step.templateName,
          languageCode: step.languageCode,
          // F58-S12: componentes ja resolvidos para este contato (nunca o contrato cru).
          components: rendered.components,
        };
        // F70-S16: o job vai para a outbox junto com o resto, nesta transacao.
        return {
          outcome: { kind: 'enqueued' },
          opened,
          job: makeEnvelope(OUTBOUND_JOB_TYPE, campaign.workspaceId, job),
        };
      };

      try {
        return await withWorkspace(campaign.workspaceId, async (tx) => {
          const done = await dispatchInTx(tx);
          await enqueueOutbox(tx, dispatchOutbox(campaign, done));
          return done.outcome;
        });
      } catch (err: unknown) {
        if (err instanceof TxAbort) return err.value as DispatchOutcome;
        if (err instanceof TemplateBlocked) {
          // Nada do disparo ficou gravado (rollback). Pausa com o motivo; o tick ve
          // `not_running` e para o lote sem reagendar — quem retoma e a pessoa.
          const pausedNow = await pauseForTemplate(campaign, err, now);
          deps.logger.warn('campaigns: modelo de mensagem bloqueia o envio — campanha pausada', {
            campaignId: campaign.id,
            reason: err.reason,
            detail: err.detail,
            pausedNow,
          });
          return { kind: 'gate_closed', reason: 'not_running', retryAt: null };
        }
        throw err;
      }
    },

    async settleCampaign(campaign: RunningCampaign, now: Date): Promise<boolean> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const rows = await tx
          .select({
            total: sql<number>`count(*)`.mapWith(Number),
            active: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('pending','sending'))`.mapWith(
              Number,
            ),
          })
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, campaign.id));
        const row = rows[0];
        if (!row) return false;
        if (!campaignIsExhausted({ total: row.total, active: row.active })) return false;

        const updated = await tx
          .update(campaigns)
          .set({ status: 'completed', nextTickAt: null, updatedAt: now })
          .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'running')))
          .returning({ id: campaigns.id });
        if (updated.length === 0) return false;
        await recordStatusChange(tx, {
          workspaceId: campaign.workspaceId,
          campaignId: campaign.id,
          action: 'campaign.completed',
          reason: 'all_recipients_done',
        });
        return true;
      });
    },

    /**
     * F58-S11 — prazo final: quem ainda estava `pending` fica de fora (`failed`
     * `campaign_end_reached`, contavel no relatorio) e a campanha fecha
     * `completed` com o motivo gravado. Se ela ja nao estava `running` (pausada
     * no meio do caminho), desfaz tudo: nao fecha campanha alheia ao tick.
     */
    async closeCampaign(
      campaign: RunningCampaign,
      reason: 'end_at_reached',
      now: Date,
    ): Promise<CloseResult> {
      try {
        return await withWorkspace(campaign.workspaceId, async (tx) => {
          const left = await tx
            .update(campaignRecipients)
            .set({ status: 'failed', failedReason: 'campaign_end_reached', nextStepAt: null })
            .where(
              and(
                eq(campaignRecipients.campaignId, campaign.id),
                eq(campaignRecipients.status, 'pending'),
              ),
            )
            .returning({ id: campaignRecipients.id });
          const updated = await tx
            .update(campaigns)
            .set({ status: 'completed', nextTickAt: null, updatedAt: now })
            .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'running')))
            .returning({ id: campaigns.id });
          if (updated.length === 0) {
            throw new TxAbort<CloseResult>({ closed: false, notReached: 0 });
          }
          await recordStatusChange(tx, {
            workspaceId: campaign.workspaceId,
            campaignId: campaign.id,
            action: 'campaign.completed',
            reason,
            extra: {
              endAt: campaign.endAt?.toISOString() ?? null,
              notReached: left.length,
            },
          });
          return { closed: true, notReached: left.length };
        });
      } catch (err: unknown) {
        if (err instanceof TxAbort) return err.value as CloseResult;
        throw err;
      }
    },

    /**
     * Pausa so o que esta `running` (nunca "pausa" campanha concluida/cancelada) e
     * grava o motivo + orientacao na mesma transacao.
     */
    async pauseCampaign(campaignId: string, reason: string): Promise<void> {
      const rows = await getDb()
        .select({ workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      const row = rows[0];
      if (!row) return;
      const paused = await withWorkspace(row.workspaceId, async (tx) => {
        const updated = await tx
          .update(campaigns)
          .set({ status: 'paused', nextTickAt: null, updatedAt: new Date() })
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'running')))
          .returning({ id: campaigns.id });
        if (updated.length === 0) return false;
        await recordStatusChange(tx, {
          workspaceId: row.workspaceId,
          campaignId,
          action: 'campaign.paused',
          reason,
        });
        return true;
      });
      if (paused) deps.logger.warn('campaigns: campanha pausada', { campaignId, reason });
    },

    /**
     * Proxima olhada: nunca ANTES do cursor do compasso (greatest — reagendar nao
     * pode liberar credito) e nunca DEPOIS do prazo final (least — o prazo fecha
     * na hora). So mexe em campanha `running`.
     */
    async scheduleNextTick(campaignId: string, at: Date): Promise<void> {
      const rows = await getDb()
        .select({ workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      const row = rows[0];
      if (!row) return;
      const atIso = at.toISOString();
      await withWorkspace(row.workspaceId, (tx) =>
        tx
          .update(campaigns)
          .set({
            nextTickAt: sql`least(greatest(coalesce(${campaigns.nextTickAt}, ${atIso}::timestamptz), ${atIso}::timestamptz), coalesce(${campaigns.endAt}, 'infinity'::timestamptz))`,
          })
          .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'running'))),
      );
    },

    async applyErrorAction(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      action: CampaignErrorAction,
    ): Promise<void> {
      await withWorkspace(campaign.workspaceId, async (tx) => {
        switch (action.kind) {
          case 'invalidate_recipient':
          case 'needs_reengagement':
          case 'count_block':
            await tx
              .update(campaignRecipients)
              .set({ status: 'failed', failedReason: action.reason, nextStepAt: null })
              .where(eq(campaignRecipients.id, dispatch.recipientId));
            break;
          case 'fail_delivery':
            await tx
              .update(campaignDeliveries)
              .set({ status: 'failed', errorMessage: action.reason, failedAt: new Date() })
              .where(
                and(
                  eq(campaignDeliveries.campaignId, campaign.id),
                  eq(campaignDeliveries.recipientId, dispatch.recipientId),
                  eq(campaignDeliveries.stepId, dispatch.stepId),
                ),
              );
            break;
          case 'pause_campaign':
            break;
        }
      });
    },
  };
}

/**
 * Falha transitoria no despacho: reagenda o MESMO step com backoff exponencial
 * (ou marca failed ao esgotar as tentativas). Nunca deixa o recipient preso em
 * `sending` — que era exatamente o estado morto do CAMP-03.
 */
async function applyFailure(
  tx: DbTx,
  recipientId: string,
  attempts: number,
  now: Date,
  reason: string,
): Promise<void> {
  const t = afterDispatchFailure(attempts, now, reason);
  await tx
    .update(campaignRecipients)
    .set({
      status: t.status,
      nextStepAt: t.nextStepAt,
      failedReason: t.failedReason,
    })
    .where(eq(campaignRecipients.id, recipientId));
}

/**
 * F58-S11 — reserva atomica de UMA mensagem: le a campanha com `FOR NO KEY UPDATE`
 * (serializa todos os dispatches da campanha, em qualquer instancia), decide
 * pelo nucleo puro `decideDispatchGate` e grava cursor do compasso + contador do
 * dia. Commit junto com a entrega; rollback devolve o credito sozinho.
 */
async function reserveDispatch(
  tx: DbTx,
  campaignId: string,
  now: Date,
  pacing: DispatchPacing,
): Promise<DispatchGateDecision> {
  const [row] = await tx
    .select({
      status: campaigns.status,
      endAt: campaigns.endAt,
      nextTickAt: campaigns.nextTickAt,
      dailyLimit: campaigns.dailyLimit,
      messagesSentToday: campaigns.messagesSentToday,
      lastDailyResetAt: campaigns.lastDailyResetAt,
      timezone: campaigns.timezone,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    // NO KEY UPDATE, nao UPDATE: o INSERT em campaign_deliveries (FK -> campaigns)
    // ja segura KEY SHARE nesta linha; FOR UPDATE conflita com KEY SHARE e dois
    // dispatches simultaneos entravam em deadlock (provado no teste de concorrencia).
    // NO KEY UPDATE serializa os dispatches entre si sem conflitar com a FK.
    .for('no key update');
  if (!row) return { kind: 'closed', reason: 'not_running', retryAt: null };

  const decision = decideDispatchGate(row, {
    now,
    ratePerMinute: pacing.ratePerMinute,
    windowMs: pacing.windowMs,
  });
  if (decision.kind === 'reserve') {
    await tx
      .update(campaigns)
      .set({
        nextTickAt: decision.patch.nextTickAt,
        messagesSentToday: decision.patch.messagesSentToday,
        lastDailyResetAt: decision.patch.lastDailyResetAt,
      })
      .where(eq(campaigns.id, campaignId));
  }
  return decision;
}

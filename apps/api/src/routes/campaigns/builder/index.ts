/**
 * API do criador guiado de campanhas (F58-S06 / CAMPAIGNS.md §4, §13).
 *
 * Um contrato único para o wizard: quais canais e modelos existem, como fica a
 * prévia com as variáveis preenchidas, quantas pessoas recebem e em quanto
 * tempo, o que ainda bloqueia o início e como mandar um teste para o próprio
 * telefone. Regra de negócio mora aqui — a tela não recalcula elegibilidade,
 * capacidade nem compliance por conta própria.
 *
 * Montado ANTES do CRUD em `../index.ts`: `/api/campaigns/builder/options`
 * precisa casar antes de `/api/campaigns/:id`.
 *
 * Erros seguem o padrão `{ code, message }` com texto pronto para exibir —
 * nunca detalhe de infraestrutura, nunca token.
 */
import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { decryptSecret, schema, type DbTx } from '@hm/db';
import type { ChannelHealth } from '@hm/channels';
import { requireAuth, requireRole, withRLS } from '../../../middlewares/auth';
import { publishOutboundJob } from '../../../mq/outbound-publisher';
import { param } from '../../conversions/types';
import { loadCampaignChannel, makeGraphPorts, type CampaignChannelSnapshot } from '../service';
import {
  estimateSchema,
  optionsQuerySchema,
  parseRequiredIdempotencyKey,
  preflightSchema,
  previewSchema,
  testSendSchema,
} from './contracts';
import { runPreflight } from './preflight';
import type { SafeTemplatePreview } from './render';
import {
  estimateCampaignBase,
  finalizeEstimate,
  loadBuilderOptions,
  loadBuilderTemplateContext,
  renderBuilderTemplate,
  type BuilderTemplateContext,
  type ChannelHealthSnapshot,
  type TemplateContextLookup,
} from './service';

type PublishOutbound = typeof publishOutboundJob;
type FetchHealth = (snapshot: CampaignChannelSnapshot) => Promise<ChannelHealth>;

export interface CampaignBuilderRouterOptions {
  readonly publishOutbound?: PublishOutbound;
  readonly fetchHealth?: FetchHealth;
  readonly decrypt?: typeof decryptSecret;
  readonly now?: () => Date;
  /** TTL do cache de saúde do canal; 0 desliga (testes). */
  readonly healthTtlMs?: number;
}

const UNKNOWN_HEALTH: ChannelHealthSnapshot = { qualityRating: 'UNKNOWN', tierLimit: 0 };

/**
 * A etapa "Quando enviar" recalcula a cada ajuste do formulário. Sem cache, cada
 * tecla viraria uma chamada à Graph — a Meta limita, e a resposta é a mesma.
 */
function createHealthCache(ttlMs: number, now: () => Date) {
  const entries = new Map<string, { readonly value: ChannelHealthSnapshot; readonly expiresAt: number }>();
  return async (
    snapshot: CampaignChannelSnapshot,
    fetchHealth: FetchHealth,
  ): Promise<ChannelHealthSnapshot> => {
    const key = snapshot.channel.id;
    const current = now().getTime();
    const cached = entries.get(key);
    if (ttlMs > 0 && cached && cached.expiresAt > current) return cached.value;
    let value: ChannelHealthSnapshot;
    try {
      value = await fetchHealth(snapshot);
    } catch {
      // Meta fora do ar não pode derrubar a etapa: segue com capacidade
      // desconhecida, e o preflight bloqueia disparo grande nesse estado.
      value = UNKNOWN_HEALTH;
    }
    if (ttlMs > 0) entries.set(key, { value, expiresAt: current + ttlMs });
    return value;
  };
}

function invalidPayload(res: Response, issues: unknown): void {
  res.status(400).json({
    code: 'CAMPAIGN_BUILDER_INVALID_PAYLOAD',
    message: 'Revise os campos indicados para continuar.',
    issues,
  });
}

const CONTEXT_ERROR = {
  campaign_not_found: {
    status: 404,
    code: 'CAMPAIGN_NOT_FOUND',
    message: 'Campanha não encontrada neste workspace.',
  },
  channel_not_available: {
    status: 422,
    code: 'CAMPAIGN_CHANNEL_NOT_AVAILABLE',
    message: 'Reconecte o WhatsApp oficial desta campanha para escolher e testar mensagens.',
  },
  template_not_usable: {
    status: 422,
    code: 'CAMPAIGN_TEMPLATE_NOT_USABLE',
    message: 'Este modelo não está aprovado e disponível neste canal. Sincronize ou escolha outro.',
  },
} as const;

function sendContextError(res: Response, lookup: Exclude<TemplateContextLookup, { ok: true }>): void {
  const response = CONTEXT_ERROR[lookup.reason];
  res.status(response.status).json({ code: response.code, message: response.message });
}

function sendRenderIssues(res: Response, issues: readonly { code: string; message: string }[]): void {
  res.status(422).json({
    code: 'CAMPAIGN_TEMPLATE_VARIABLES_INVALID',
    message: 'Confira as variáveis desta mensagem antes de continuar.',
    issues,
  });
}

const CAMPAIGN_NOT_FOUND = {
  code: CONTEXT_ERROR.campaign_not_found.code,
  message: CONTEXT_ERROR.campaign_not_found.message,
} as const;

/** Canal utilizável para envio real: provider oficial, ativo e com credencial. */
function channelIsAvailable(
  snapshot: CampaignChannelSnapshot | null,
): snapshot is CampaignChannelSnapshot {
  return (
    snapshot !== null &&
    snapshot.channel.provider === 'meta_whatsapp' &&
    snapshot.channel.isActive &&
    snapshot.channel.phoneNumberId !== null &&
    snapshot.channel.wabaId !== null &&
    snapshot.accessToken.trim().length > 0
  );
}

/** Telefone mascarado para o audit log — rastreável sem virar depósito de PII. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

type MessageRow = typeof schema.messages.$inferSelect;

type PreparedTestSend =
  | { readonly kind: 'replay'; readonly message: MessageRow }
  | { readonly kind: 'created'; readonly message: MessageRow; readonly job: Record<string, unknown> }
  | null;

/**
 * Persiste a mensagem de teste `pending` e monta o job outbound — o MESMO
 * caminho de um envio normal (LIVECHAT.md §3.1), porque um teste que usa outro
 * caminho não prova nada sobre o envio real.
 *
 * Idempotência: a chave do cliente vira `outbound_idempotency_key` (índice único
 * parcial). Clique duplo devolve a mesma mensagem em vez de mandar duas.
 *
 * Isolamento das métricas: não cria `campaign_deliveries` nem `campaign_recipients`,
 * então nada disso entra em `campaign_metrics` (que agrega só por delivery).
 */
export async function prepareTestSend(
  tx: DbTx,
  args: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly campaignId: string;
    readonly to: string;
    readonly idempotencyKey: string;
    readonly context: BuilderTemplateContext;
    readonly preview: SafeTemplatePreview;
  },
): Promise<PreparedTestSend> {
  const storageKey = createHash('sha256')
    .update(`campaign-test:${args.workspaceId}:${args.campaignId}:${args.idempotencyKey}`)
    .digest('hex');

  const findExisting = async (): Promise<MessageRow | undefined> => {
    const [row] = await tx
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.workspaceId, args.workspaceId),
          eq(schema.messages.outboundIdempotencyKey, storageKey),
        ),
      )
      .limit(1);
    return row;
  };

  const existing = await findExisting();
  if (existing) return { kind: 'replay', message: existing };

  // A resposta ao teste chega como qualquer inbound e precisa de conversa: usa a
  // mesma chave (channel_id, remote_id) do worker inbound para não duplicar.
  const remoteId = args.to.slice(1);
  // Se o número já é um contato do workspace, a conversa nasce ligada a ele —
  // um teste não deve deixar conversa órfã no inbox de quem já está na base.
  const [knownContact] = await tx
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.workspaceId, args.workspaceId),
        eq(schema.contacts.phone, args.to),
      ),
    )
    .limit(1);
  const inserted = await tx
    .insert(schema.conversations)
    .values({
      workspaceId: args.workspaceId,
      channelId: args.context.campaign.channelId,
      contactId: knownContact?.id ?? null,
      remoteId,
      kind: 'direct',
      status: 'open',
    })
    .onConflictDoNothing()
    .returning({ id: schema.conversations.id });
  const [conversation] =
    inserted.length > 0
      ? inserted
      : await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(
            and(
              eq(schema.conversations.workspaceId, args.workspaceId),
              eq(schema.conversations.channelId, args.context.campaign.channelId),
              eq(schema.conversations.remoteId, remoteId),
            ),
          )
          .limit(1);
  if (!conversation) return null;

  const insertedMessages = await tx
    .insert(schema.messages)
    .values({
      workspaceId: args.workspaceId,
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'member',
      senderMemberId: args.memberId,
      type: 'template',
      content: args.preview.body || args.preview.header?.text || null,
      viewStatus: 'pending',
      outboundIdempotencyKey: storageKey,
      metadata: {
        campaignTest: true,
        campaignId: args.campaignId,
        templateId: args.context.template.id,
      },
    })
    .onConflictDoNothing()
    .returning();
  const message = insertedMessages[0];
  if (!message) {
    // Corrida no clique duplo: o índice único deixou só um INSERT passar.
    const replayed = await findExisting();
    return replayed ? { kind: 'replay', message: replayed } : null;
  }

  await tx.insert(schema.auditLogs).values({
    workspaceId: args.workspaceId,
    actorMemberId: args.memberId,
    actorType: 'member',
    action: 'campaign.test_send',
    resourceType: 'campaign',
    resourceId: args.campaignId,
    metadata: {
      templateId: args.context.template.id,
      templateName: args.context.template.name,
      messageId: message.id,
      to: maskPhone(args.to),
    },
  });

  return {
    kind: 'created',
    message,
    job: {
      ...args.preview.outbound,
      channelId: args.context.campaign.channelId,
      conversationId: conversation.id,
      messageId: message.id,
      chatId: remoteId,
    },
  };
}

export function createCampaignBuilderRouter(
  options: CampaignBuilderRouterOptions = {},
): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('campaign.edit')] as const;
  const decrypt = options.decrypt ?? decryptSecret;
  const publishOutbound = options.publishOutbound ?? publishOutboundJob;
  const now = options.now ?? (() => new Date());
  const fetchHealth =
    options.fetchHealth ?? ((snapshot: CampaignChannelSnapshot) => makeGraphPorts(snapshot).fetchQuality());
  const healthFor = createHealthCache(options.healthTtlMs ?? 60_000, now);

  router.get('/api/campaigns/builder/options', ...guard, async (req: Request, res: Response) => {
    const parsed = optionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      invalidPayload(res, parsed.error.issues);
      return;
    }
    const result = await req.scoped!((tx) =>
      loadBuilderOptions(tx, { workspaceId: req.auth!.workspace.id, ...parsed.data }, decrypt),
    );
    res.json(result);
  });

  router.post('/api/campaigns/:id/builder/preview', ...guard, async (req: Request, res: Response) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidPayload(res, parsed.error.issues);
      return;
    }
    const lookup = await req.scoped!((tx) =>
      loadBuilderTemplateContext(
        tx,
        { workspaceId: req.auth!.workspace.id, campaignId: param(req, 'id'), ...parsed.data },
        decrypt,
      ),
    );
    if (!lookup.ok) {
      sendContextError(res, lookup);
      return;
    }
    const render = renderBuilderTemplate(lookup.value, parsed.data.bindings);
    if (!render.ok) {
      sendRenderIssues(res, render.issues);
      return;
    }
    res.json({
      template: {
        id: lookup.value.template.id,
        name: lookup.value.template.name,
        language: lookup.value.template.language,
        category: lookup.value.template.category,
      },
      preview: render.preview,
    });
  });

  /** Estimativa de público, capacidade e duração — reage a ajustes ainda não salvos. */
  router.post('/api/campaigns/:id/builder/estimate', ...guard, async (req: Request, res: Response) => {
    const parsed = estimateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      invalidPayload(res, parsed.error.issues);
      return;
    }
    const campaignId = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const loaded = await req.scoped!(async (tx) => {
      const base = await estimateCampaignBase(tx, workspaceId, campaignId);
      if (!base) return null;
      return { base, snapshot: await loadCampaignChannel(tx, campaignId) };
    });
    if (!loaded) {
      res.status(404).json(CAMPAIGN_NOT_FOUND);
      return;
    }
    const snapshot = loaded.snapshot;
    const health = channelIsAvailable(snapshot)
      ? await healthFor(snapshot, fetchHealth)
      : UNKNOWN_HEALTH;
    res.json(finalizeEstimate(loaded.base, health, parsed.data, now()));
  });

  /** Revisão: o que ainda bloqueia o início e em que etapa se conserta. */
  router.post('/api/campaigns/:id/builder/preflight', ...guard, async (req: Request, res: Response) => {
    const parsed = preflightSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      invalidPayload(res, parsed.error.issues);
      return;
    }
    const campaignId = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const loaded = await req.scoped!(async (tx) => {
      const base = await estimateCampaignBase(tx, workspaceId, campaignId);
      if (!base) return null;
      return { base, snapshot: await loadCampaignChannel(tx, campaignId) };
    });
    if (!loaded) {
      res.status(404).json(CAMPAIGN_NOT_FOUND);
      return;
    }
    const snapshot = loaded.snapshot;
    const available = channelIsAvailable(snapshot);
    const health = available ? await healthFor(snapshot, fetchHealth) : UNKNOWN_HEALTH;
    res.json(
      runPreflight({
        base: loaded.base,
        channelAvailable: available,
        health,
        overrides: parsed.data,
        now: now(),
      }),
    );
  });

  router.post('/api/campaigns/:id/builder/test', ...guard, async (req: Request, res: Response) => {
    const parsed = testSendSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidPayload(res, parsed.error.issues);
      return;
    }
    const idempotencyKey = parseRequiredIdempotencyKey(req.headers['idempotency-key']);
    if (idempotencyKey === null) {
      res.status(400).json({
        code: 'CAMPAIGN_TEST_IDEMPOTENCY_REQUIRED',
        message: 'Envie o cabeçalho Idempotency-Key para testar sem risco de enviar duas vezes.',
      });
      return;
    }
    // Variável de botão só chega íntegra ao provider depois do F58-S12 (o job
    // outbound ainda descarta `sub_type`/`index`). Recusar é melhor do que
    // entregar um teste que a Meta rejeita por payload incompleto.
    if (parsed.data.bindings.some((binding) => binding.component === 'button')) {
      res.status(422).json({
        code: 'CAMPAIGN_TEST_BUTTON_VARIABLE_UNSUPPORTED',
        message:
          'O envio de teste ainda não cobre variáveis de botão. Teste este modelo direto no WhatsApp por enquanto.',
      });
      return;
    }

    const campaignId = param(req, 'id');
    const workspaceId = req.auth!.workspace.id;
    const lookup = await req.scoped!((tx) =>
      loadBuilderTemplateContext(
        tx,
        {
          workspaceId,
          campaignId,
          templateId: parsed.data.templateId,
          ...(parsed.data.sampleContactId === undefined
            ? {}
            : { sampleContactId: parsed.data.sampleContactId }),
        },
        decrypt,
      ),
    );
    if (!lookup.ok) {
      sendContextError(res, lookup);
      return;
    }
    if (lookup.value.campaign.status !== 'draft') {
      res.status(409).json({
        code: 'CAMPAIGN_TEST_REQUIRES_DRAFT',
        message: 'O envio de teste vale enquanto a campanha ainda é um rascunho.',
      });
      return;
    }
    const render = renderBuilderTemplate(lookup.value, parsed.data.bindings);
    if (!render.ok) {
      sendRenderIssues(res, render.issues);
      return;
    }

    const prepared = await req.scoped!((tx) =>
      prepareTestSend(tx, {
        workspaceId,
        memberId: req.auth!.member.id,
        campaignId,
        to: parsed.data.to,
        idempotencyKey,
        context: lookup.value,
        preview: render.preview,
      }),
    );
    if (prepared === null) {
      res.status(409).json({
        code: 'CAMPAIGN_TEST_NOT_PREPARED',
        message: 'Não foi possível preparar o envio de teste agora. Tente novamente.',
      });
      return;
    }
    if (prepared.kind === 'replay') {
      res.status(202).json({ messageId: prepared.message.id, queued: true, replayed: true });
      return;
    }
    await publishOutbound(workspaceId, prepared.job);
    res.status(202).json({ messageId: prepared.message.id, queued: true, replayed: false });
  });

  return router;
}

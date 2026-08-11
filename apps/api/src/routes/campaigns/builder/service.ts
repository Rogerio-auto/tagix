/**
 * Dados do criador guiado de campanhas (F58-S06).
 *
 * O objetivo do módulo é tirar regra de negócio do wizard: quem pode ser
 * escolhido, o que cada canal sabe fazer, quantas pessoas realmente vão receber
 * e quanto tempo isso leva são respostas do servidor, não do formulário.
 *
 * Toda leitura roda dentro de `req.scoped` (RLS): nenhuma consulta aqui pode
 * enxergar outro workspace, e o `workspace_id` explícito nas condições é defesa
 * em profundidade sobre a policy.
 */
import { and, asc, eq, gt, ilike, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { decryptSecret, schema, type DbTx } from '@hm/db';
import type { DeliveryOverrides, TemplateBinding } from './contracts';
import { LARGE_SEND_THRESHOLD } from './contracts';
import { estimateSchedule, type ScheduleEstimate, type SendWindowsConfig } from './duration';
import { renderTemplate, type ContactSample, type RenderOutcome } from './render';

type Decrypt = typeof decryptSecret;

export interface BuilderOptionsInput {
  readonly workspaceId: string;
  readonly channelId?: string | undefined;
  readonly search?: string | undefined;
  readonly category?: string | undefined;
  readonly language?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** Por que um canal ativo ainda não serve para este fluxo. */
export type ChannelIneligibleReason =
  | 'provider_unsupported'
  | 'missing_credentials'
  | 'incomplete_setup';

export interface ChannelCapabilities {
  /** Aceita campanha pelo criador guiado desta fase. */
  readonly guidedCampaigns: boolean;
  /** Exige modelo aprovado pela Meta para iniciar conversa (HSM). */
  readonly approvedMessageTemplates: boolean;
  /** Permite mensagem livre proativa (fora do modelo aprovado). */
  readonly freeformMessage: boolean;
  readonly sequence: boolean;
  readonly testSend: boolean;
  /** Categoria MARKETING exige opt-in explícito por contato. */
  readonly requiresMarketingOptIn: boolean;
}

const CAPABILITIES: Readonly<Record<string, ChannelCapabilities>> = {
  meta_whatsapp: {
    guidedCampaigns: true,
    approvedMessageTemplates: true,
    freeformMessage: false,
    sequence: true,
    testSend: true,
    requiresMarketingOptIn: true,
  },
  meta_instagram: {
    guidedCampaigns: false,
    approvedMessageTemplates: false,
    freeformMessage: true,
    sequence: false,
    testSend: false,
    requiresMarketingOptIn: true,
  },
  waha: {
    guidedCampaigns: false,
    approvedMessageTemplates: false,
    freeformMessage: true,
    sequence: false,
    testSend: false,
    requiresMarketingOptIn: true,
  },
};

const UNKNOWN_PROVIDER_CAPABILITIES: ChannelCapabilities = {
  guidedCampaigns: false,
  approvedMessageTemplates: false,
  freeformMessage: false,
  sequence: false,
  testSend: false,
  requiresMarketingOptIn: true,
};

const INELIGIBLE_MESSAGE: Readonly<Record<ChannelIneligibleReason, string>> = {
  provider_unsupported:
    'Este canal não usa modelos aprovados do WhatsApp; o envio em massa por ele entra em uma fase seguinte.',
  missing_credentials: 'Reconecte este número do WhatsApp para voltar a enviar campanhas por ele.',
  incomplete_setup: 'Conclua a conexão deste número do WhatsApp para usá-lo em campanhas.',
};

export interface BuilderChannelOption {
  readonly id: string;
  readonly name: string;
  readonly displayHandle: string | null;
  readonly provider: string;
  readonly eligible: boolean;
  readonly ineligibleReason: ChannelIneligibleReason | null;
  readonly ineligibleMessage: string | null;
  readonly capabilities: ChannelCapabilities;
  readonly approvedTemplateCount: number;
  readonly lastSyncedAt: string | null;
}

export interface BuilderTemplateOption {
  readonly id: string;
  readonly channelId: string;
  readonly name: string;
  readonly language: string;
  readonly category: string;
  readonly components: unknown;
}

export interface BuilderOptions {
  readonly modes: ReadonlyArray<{
    readonly id: 'single' | 'sequence';
    readonly label: string;
    readonly description: string;
  }>;
  readonly channels: readonly BuilderChannelOption[];
  readonly templates: readonly BuilderTemplateOption[];
  readonly page: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

const MODES = [
  {
    id: 'single' as const,
    label: 'Envio único',
    description: 'Uma mensagem enviada uma vez para todo o público escolhido.',
  },
  {
    id: 'sequence' as const,
    label: 'Sequência de mensagens',
    description: 'Duas ou mais mensagens organizadas com intervalos entre elas.',
  },
];

function usableToken(
  enc: string | null,
  keyVersion: number | null,
  decrypt: Decrypt,
): boolean {
  if (enc === null || keyVersion === null) return false;
  try {
    return decrypt(enc, keyVersion).trim().length > 0;
  } catch {
    // Chave rotacionada sem re-cifrar / registro corrompido: o canal existe mas
    // não envia. Tratar como "reconecte" é mais honesto do que sumir com ele.
    return false;
  }
}

function ineligibility(row: {
  readonly provider: string;
  readonly phoneNumberId: string | null;
  readonly wabaId: string | null;
  readonly hasToken: boolean;
}): ChannelIneligibleReason | null {
  const capabilities = CAPABILITIES[row.provider] ?? UNKNOWN_PROVIDER_CAPABILITIES;
  if (!capabilities.guidedCampaigns) return 'provider_unsupported';
  if (row.phoneNumberId === null || row.wabaId === null) return 'incomplete_setup';
  if (!row.hasToken) return 'missing_credentials';
  return null;
}

/**
 * Canais ATIVOS do workspace com as capacidades de cada provider. Canais que não
 * servem ao fluxo continuam na lista com o motivo — sumir com eles produz a
 * pergunta "cadê meu Instagram?" sem resposta na tela.
 */
export async function loadBuilderOptions(
  tx: DbTx,
  input: BuilderOptionsInput,
  decrypt: Decrypt = decryptSecret,
): Promise<BuilderOptions> {
  const channelRows = await tx
    .select({
      id: schema.channels.id,
      name: schema.channels.name,
      displayHandle: schema.channels.displayHandle,
      provider: schema.channels.provider,
      phoneNumberId: schema.channels.phoneNumberId,
      wabaId: schema.channels.wabaId,
      accessTokenEnc: schema.channelSecrets.accessTokenEnc,
      keyVersion: schema.channelSecrets.keyVersion,
      lastSyncedAt: schema.channelMessageTemplateSyncStates.lastSuccessfulSyncAt,
    })
    .from(schema.channels)
    .leftJoin(
      schema.channelSecrets,
      eq(schema.channelSecrets.channelId, schema.channels.id),
    )
    .leftJoin(
      schema.channelMessageTemplateSyncStates,
      and(
        eq(schema.channelMessageTemplateSyncStates.channelId, schema.channels.id),
        eq(schema.channelMessageTemplateSyncStates.workspaceId, input.workspaceId),
      ),
    )
    .where(
      and(
        eq(schema.channels.workspaceId, input.workspaceId),
        eq(schema.channels.isActive, true),
        input.channelId ? eq(schema.channels.id, input.channelId) : undefined,
      ),
    )
    .orderBy(asc(schema.channels.name));

  // Uma agregação para todos os canais — nada de contagem por linha.
  const approvedCounts = new Map<string, number>();
  if (channelRows.length > 0) {
    const counts = await tx
      .select({
        channelId: schema.channelMessageTemplates.channelId,
        total: sql<number>`count(*)::int`,
      })
      .from(schema.channelMessageTemplates)
      .where(
        and(
          eq(schema.channelMessageTemplates.workspaceId, input.workspaceId),
          eq(schema.channelMessageTemplates.status, 'APPROVED'),
          eq(schema.channelMessageTemplates.isAvailable, true),
          inArray(
            schema.channelMessageTemplates.channelId,
            channelRows.map((row) => row.id),
          ),
        ),
      )
      .groupBy(schema.channelMessageTemplates.channelId);
    for (const row of counts) approvedCounts.set(row.channelId, row.total);
  }

  const channels: BuilderChannelOption[] = channelRows.map((row) => {
    const hasToken = usableToken(row.accessTokenEnc, row.keyVersion, decrypt);
    const reason = ineligibility({ ...row, hasToken });
    return {
      id: row.id,
      name: row.name,
      displayHandle: row.displayHandle,
      provider: row.provider,
      eligible: reason === null,
      ineligibleReason: reason,
      ineligibleMessage: reason === null ? null : INELIGIBLE_MESSAGE[reason],
      capabilities: CAPABILITIES[row.provider] ?? UNKNOWN_PROVIDER_CAPABILITIES,
      approvedTemplateCount: approvedCounts.get(row.id) ?? 0,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    };
  });

  // Modelos só existem para canal elegível: listar modelo de canal desconectado
  // seria oferecer uma escolha que a Revisão vai recusar depois.
  const eligibleIds = channels.filter((channel) => channel.eligible).map((channel) => channel.id);
  const conditions: SQL[] = [
    eq(schema.channelMessageTemplates.workspaceId, input.workspaceId),
    eq(schema.channelMessageTemplates.status, 'APPROVED'),
    eq(schema.channelMessageTemplates.isAvailable, true),
  ];
  if (eligibleIds.length > 0) {
    conditions.push(inArray(schema.channelMessageTemplates.channelId, eligibleIds));
  }
  if (input.search) {
    conditions.push(ilike(schema.channelMessageTemplates.name, `%${input.search}%`));
  }
  if (input.category) conditions.push(eq(schema.channelMessageTemplates.category, input.category));
  if (input.language) conditions.push(eq(schema.channelMessageTemplates.language, input.language));
  if (input.cursor) conditions.push(gt(schema.channelMessageTemplates.id, input.cursor));

  const templateRows =
    eligibleIds.length === 0
      ? []
      : await tx
          .select({
            id: schema.channelMessageTemplates.id,
            channelId: schema.channelMessageTemplates.channelId,
            name: schema.channelMessageTemplates.name,
            language: schema.channelMessageTemplates.language,
            category: schema.channelMessageTemplates.category,
            components: schema.channelMessageTemplates.components,
          })
          .from(schema.channelMessageTemplates)
          .where(and(...conditions))
          .orderBy(asc(schema.channelMessageTemplates.id))
          .limit(input.limit + 1);

  const hasMore = templateRows.length > input.limit;
  const templates = templateRows.slice(0, input.limit);

  return {
    modes: MODES,
    channels,
    templates,
    page: { nextCursor: hasMore ? (templates.at(-1)?.id ?? null) : null, hasMore },
  };
}

/* ── Contexto de modelo (prévia e teste) ────────────────────────────────── */

export interface BuilderTemplateContext {
  readonly campaign: typeof schema.campaigns.$inferSelect;
  readonly channel: typeof schema.channels.$inferSelect;
  readonly template: typeof schema.channelMessageTemplates.$inferSelect;
  readonly contact: ContactSample | null;
}

export type TemplateContextLookup =
  | { readonly ok: true; readonly value: BuilderTemplateContext }
  | {
      readonly ok: false;
      readonly reason: 'campaign_not_found' | 'channel_not_available' | 'template_not_usable';
    };

/**
 * Resolve campanha + canal + modelo aprovado + contato de amostra em UMA porta.
 * Cada negativa tem um motivo próprio porque a tela precisa dizer o que fazer —
 * "não encontrado" para tudo obrigaria o usuário a adivinhar.
 */
export async function loadBuilderTemplateContext(
  tx: DbTx,
  args: {
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly templateId: string;
    readonly sampleContactId?: string | undefined;
  },
  decrypt: Decrypt = decryptSecret,
): Promise<TemplateContextLookup> {
  const [campaign] = await tx
    .select()
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.workspaceId, args.workspaceId),
        eq(schema.campaigns.id, args.campaignId),
      ),
    )
    .limit(1);
  if (!campaign) return { ok: false, reason: 'campaign_not_found' };

  const [joined] = await tx
    .select({ channel: schema.channels, secret: schema.channelSecrets })
    .from(schema.channels)
    .leftJoin(schema.channelSecrets, eq(schema.channelSecrets.channelId, schema.channels.id))
    .where(
      and(
        eq(schema.channels.workspaceId, args.workspaceId),
        eq(schema.channels.id, campaign.channelId),
        eq(schema.channels.provider, 'meta_whatsapp'),
        eq(schema.channels.isActive, true),
        isNotNull(schema.channels.phoneNumberId),
        isNotNull(schema.channels.wabaId),
      ),
    )
    .limit(1);
  if (
    !joined ||
    !usableToken(joined.secret?.accessTokenEnc ?? null, joined.secret?.keyVersion ?? null, decrypt)
  ) {
    return { ok: false, reason: 'channel_not_available' };
  }

  const [template] = await tx
    .select()
    .from(schema.channelMessageTemplates)
    .where(
      and(
        eq(schema.channelMessageTemplates.workspaceId, args.workspaceId),
        eq(schema.channelMessageTemplates.channelId, campaign.channelId),
        eq(schema.channelMessageTemplates.id, args.templateId),
        eq(schema.channelMessageTemplates.status, 'APPROVED'),
        eq(schema.channelMessageTemplates.isAvailable, true),
      ),
    )
    .limit(1);
  if (!template) return { ok: false, reason: 'template_not_usable' };

  if (!args.sampleContactId) {
    return { ok: true, value: { campaign, channel: joined.channel, template, contact: null } };
  }
  const [contact] = await tx
    .select({
      displayName: schema.contacts.displayName,
      phone: schema.contacts.phone,
      email: schema.contacts.email,
      customFields: schema.contacts.customFields,
    })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.workspaceId, args.workspaceId),
        eq(schema.contacts.id, args.sampleContactId),
      ),
    )
    .limit(1);
  return {
    ok: true,
    value: { campaign, channel: joined.channel, template, contact: contact ?? null },
  };
}

export function renderBuilderTemplate(
  context: BuilderTemplateContext,
  bindings: readonly TemplateBinding[],
): RenderOutcome {
  return renderTemplate({
    name: context.template.name,
    language: context.template.language,
    components: context.template.components,
    bindings,
    contact: context.contact,
  });
}

/* ── Estimativa de público e duração ────────────────────────────────────── */

/** Colunas da agregação. `count(*)::int` pode voltar como string dependendo do driver. */
type AggregateRow = Record<
  'total' | 'eligible' | 'invalid_phone' | 'duplicate' | 'opted_out' | 'no_consent',
  number | string
> &
  Record<string, unknown>;

export interface CampaignStepSummary {
  readonly position: number;
  readonly templateName: string;
  readonly languageCode: string;
  readonly delaySeconds: number;
  readonly templateComponents: unknown;
  readonly category: string | null;
  readonly status: string | null;
  readonly isAvailable: boolean | null;
  readonly templateComponentsFromCatalog: unknown;
}

export interface AudienceBreakdown {
  readonly total: number;
  readonly eligible: number;
  readonly invalid: number;
  readonly duplicate: number;
  readonly optedOut: number;
  readonly noConsent: number;
}

export interface EstimateBase {
  readonly campaign: typeof schema.campaigns.$inferSelect;
  readonly steps: readonly CampaignStepSummary[];
  readonly totalDelaySeconds: number;
  readonly requiresMarketingOptIn: boolean;
  readonly audience: AudienceBreakdown;
}

const int = (value: number | string | undefined): number => Number(value ?? 0);

/**
 * Uma única varredura classifica cada destinatário EXATAMENTE uma vez (telefone
 * inválido > duplicado > opt-out > sem consentimento > apto), então as fatias
 * somam o total e a tela nunca mostra números que não fecham.
 *
 * `requiresMarketingOptIn` vem da categoria do modelo: exigir opt-in num aviso
 * transacional (UTILITY) zeraria o público de quem nunca pediu marketing.
 */
export async function estimateCampaignBase(
  tx: DbTx,
  workspaceId: string,
  campaignId: string,
): Promise<EstimateBase | null> {
  const [campaign] = await tx
    .select()
    .from(schema.campaigns)
    .where(
      and(eq(schema.campaigns.workspaceId, workspaceId), eq(schema.campaigns.id, campaignId)),
    )
    .limit(1);
  if (!campaign) return null;

  // Cada step é casado com o catálogo local por (canal, nome, idioma) — é o que
  // o F58-S02/S04 mantém fresco por sincronização e webhook.
  const stepRows = await tx
    .select({
      position: schema.campaignSteps.position,
      templateName: schema.campaignSteps.templateName,
      languageCode: schema.campaignSteps.languageCode,
      delaySeconds: schema.campaignSteps.delaySeconds,
      templateComponents: schema.campaignSteps.templateComponents,
      category: schema.channelMessageTemplates.category,
      status: schema.channelMessageTemplates.status,
      isAvailable: schema.channelMessageTemplates.isAvailable,
      templateComponentsFromCatalog: schema.channelMessageTemplates.components,
    })
    .from(schema.campaignSteps)
    .leftJoin(
      schema.channelMessageTemplates,
      and(
        eq(schema.channelMessageTemplates.workspaceId, workspaceId),
        eq(schema.channelMessageTemplates.channelId, campaign.channelId),
        eq(schema.channelMessageTemplates.name, schema.campaignSteps.templateName),
        eq(schema.channelMessageTemplates.language, schema.campaignSteps.languageCode),
      ),
    )
    .where(eq(schema.campaignSteps.campaignId, campaignId))
    .orderBy(asc(schema.campaignSteps.position));

  const requiresMarketingOptIn = stepRows.some((step) => step.category === 'MARKETING');
  const totalDelaySeconds = stepRows.reduce((total, step) => total + step.delaySeconds, 0);

  const rows = await tx.execute<AggregateRow>(sql`
    with base as (
      select
        cr.id,
        c.phone,
        c.marketing_opt_in,
        c.opt_out_at,
        regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g') as normalized_phone
      from ${schema.campaignRecipients} cr
      join ${schema.contacts} c on c.id = cr.contact_id
      where cr.workspace_id = ${workspaceId}::uuid
        and cr.campaign_id = ${campaignId}::uuid
    ), ranked as (
      select *, row_number() over (partition by normalized_phone order by id) as phone_rank
      from base
    ), classified as (
      select case
        when phone is null or phone !~ '^\\+[1-9][0-9]{7,14}$' then 'invalid_phone'
        when phone_rank > 1 then 'duplicate'
        when opt_out_at is not null then 'opted_out'
        when ${requiresMarketingOptIn}::boolean and marketing_opt_in is not true then 'no_consent'
        else 'eligible'
      end as class
      from ranked
    )
    select
      count(*)::int as total,
      count(*) filter (where class = 'eligible')::int as eligible,
      count(*) filter (where class = 'invalid_phone')::int as invalid_phone,
      count(*) filter (where class = 'duplicate')::int as duplicate,
      count(*) filter (where class = 'opted_out')::int as opted_out,
      count(*) filter (where class = 'no_consent')::int as no_consent
    from classified
  `);
  const aggregate = Array.from(rows)[0];

  return {
    campaign,
    steps: stepRows,
    totalDelaySeconds,
    requiresMarketingOptIn,
    audience: {
      total: int(aggregate?.total),
      eligible: int(aggregate?.eligible),
      invalid: int(aggregate?.invalid_phone),
      duplicate: int(aggregate?.duplicate),
      optedOut: int(aggregate?.opted_out),
      noConsent: int(aggregate?.no_consent),
    },
  };
}

export interface ChannelHealthSnapshot {
  readonly qualityRating: string;
  readonly tierLimit: number;
}

export interface EstimateWarning {
  readonly code: string;
  readonly message: string;
  readonly blocking: boolean;
}

export interface CampaignEstimate {
  readonly audience: AudienceBreakdown;
  readonly messages: number;
  readonly steps: number;
  readonly capacity: {
    readonly ratePerMinute: number;
    readonly configuredDailyLimit: number;
    readonly providerDailyLimit: number | null;
    readonly effectiveDailyLimit: number;
    readonly quality: string;
    readonly providerCapacityKnown: boolean;
  };
  readonly duration: ScheduleEstimate;
  readonly warnings: readonly EstimateWarning[];
  readonly canContinue: boolean;
}

/** Configuração efetiva de entrega: o que a etapa pediu, senão o que está salvo. */
export function resolveDeliverySettings(
  campaign: typeof schema.campaigns.$inferSelect,
  overrides: DeliveryOverrides,
  now: Date,
): {
  readonly ratePerMinute: number;
  readonly dailyLimit: number | null;
  readonly sendWindows: SendWindowsConfig;
  readonly timezone: string;
  readonly startAt: Date;
} {
  const timezone = overrides.timezone ?? campaign.timezone;
  const persisted = campaign.sendWindows as SendWindowsConfig;
  const startAtRaw = overrides.startAt === undefined ? campaign.startAt : overrides.startAt;
  const startAt = startAtRaw ? new Date(startAtRaw) : now;
  return {
    ratePerMinute: overrides.ratePerMinute ?? campaign.rateLimitPerMinute,
    dailyLimit: overrides.dailyLimit === undefined ? campaign.dailyLimit : overrides.dailyLimit,
    sendWindows: overrides.sendWindows ?? persisted,
    timezone,
    // Agendamento no passado não encolhe a duração: o envio começa quando começa.
    startAt: Number.isNaN(startAt.getTime()) || startAt < now ? now : startAt,
  };
}

export function finalizeEstimate(
  base: EstimateBase,
  health: ChannelHealthSnapshot,
  overrides: DeliveryOverrides = {},
  now: Date = new Date(),
): CampaignEstimate {
  const settings = resolveDeliverySettings(base.campaign, overrides, now);
  // As etapas Público e Quando enviar vêm ANTES de escolher a mensagem: assumir
  // uma mensagem por pessoa mantém a estimativa útil desde o começo do fluxo, em
  // vez de mostrar "0 mensagens" para um público já montado.
  const messages = base.audience.eligible * Math.max(1, base.steps.length);
  const providerCapacityKnown = health.qualityRating !== 'UNKNOWN' && health.tierLimit > 0;
  const configuredDailyLimit =
    settings.dailyLimit ?? (providerCapacityKnown ? health.tierLimit : Number.MAX_SAFE_INTEGER);
  const effectiveDailyLimit = providerCapacityKnown
    ? Math.max(1, Math.min(configuredDailyLimit, health.tierLimit))
    : Math.max(1, configuredDailyLimit);

  const duration = estimateSchedule({
    messages,
    ratePerMinute: settings.ratePerMinute,
    dailyLimit: effectiveDailyLimit,
    sendWindows: settings.sendWindows,
    timezone: settings.timezone,
    startAt: settings.startAt,
  });

  const warnings: EstimateWarning[] = [];
  if (!providerCapacityKnown && base.audience.eligible > LARGE_SEND_THRESHOLD) {
    warnings.push({
      code: 'CAMPAIGN_PROVIDER_CAPACITY_UNKNOWN',
      message:
        'Confirme a qualidade e a capacidade do canal antes de enviar para mais de 1.000 contatos.',
      blocking: true,
    });
  }
  if (health.qualityRating === 'YELLOW') {
    warnings.push({
      code: 'CAMPAIGN_CHANNEL_QUALITY_WARNING',
      message: 'A qualidade do canal caiu; o envio vai seguir num ritmo mais conservador.',
      blocking: false,
    });
  }
  if (health.qualityRating === 'RED') {
    warnings.push({
      code: 'CAMPAIGN_CHANNEL_BLOCKED',
      message: 'O canal está com qualidade crítica e não pode iniciar a campanha agora.',
      blocking: true,
    });
  }
  if (duration.approximateDays > 1) {
    warnings.push({
      code: 'CAMPAIGN_SPLIT_ACROSS_DAYS',
      message: `O público não cabe em um dia: o envio termina em cerca de ${duration.approximateDays} dias.`,
      blocking: false,
    });
  }
  if (duration.exceedsHorizon) {
    warnings.push({
      code: 'CAMPAIGN_DURATION_UNFEASIBLE',
      message:
        'Com este ritmo e estes horários o envio levaria mais de um ano. Aumente o ritmo ou amplie os horários.',
      blocking: true,
    });
  }
  if (base.audience.eligible === 0) {
    warnings.push({
      code: 'CAMPAIGN_AUDIENCE_EMPTY',
      message: 'Nenhum contato deste público pode receber a campanha.',
      blocking: true,
    });
  }

  return {
    audience: base.audience,
    messages,
    steps: base.steps.length,
    capacity: {
      ratePerMinute: settings.ratePerMinute,
      configuredDailyLimit:
        configuredDailyLimit === Number.MAX_SAFE_INTEGER ? effectiveDailyLimit : configuredDailyLimit,
      providerDailyLimit: providerCapacityKnown ? health.tierLimit : null,
      effectiveDailyLimit,
      quality: health.qualityRating,
      providerCapacityKnown,
    },
    duration,
    warnings,
    canContinue: warnings.every((warning) => !warning.blocking),
  };
}

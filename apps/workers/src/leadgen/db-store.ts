/**
 * Persistência do lead de anúncio (F69-S03).
 *
 * Tudo que é do workspace roda em `withWorkspace` (RLS). A gravação do lead é UMA
 * transação, com a linha do lead travada: contato, conversa, mensagem e card entram
 * juntos ou não entram.
 *
 * ## Contato: casar antes de criar
 *
 * Quem preenche o formulário muitas vezes já falou com a empresa pelo WhatsApp. Criar
 * um contato novo partiria o histórico da pessoa em dois. A ordem de busca:
 * identidade por telefone → identidade por e-mail → contato com o mesmo telefone
 * (o inbound grava o telefone só com dígitos) → criar.
 *
 * ## Conversa: só com canal de WhatsApp da Meta ativo
 *
 * A conversa é aberta no canal WhatsApp Cloud do workspace, com `remote_id` = dígitos
 * do telefone — exatamente a chave que o inbound usa. Quando a pessoa responder, a
 * mensagem cai nesta mesma conversa. Sem canal ou sem telefone válido, o lead vira
 * contato e card, sem conversa.
 *
 * ## Webhooks de saída (F70-S13, F70-S14, F70-S16)
 *
 * Gravados na OUTBOX, na MESMA transação do lead (o relay publica depois do commit,
 * com confirms), com os construtores do catálogo, na ordem em que as coisas
 * nasceram:
 * 1. `conversation.opened` (`trigger: 'lead_ad'`) — só a conversa que ESTE lead
 *    abriu (eventId canônico `<conversa>:opened`, o mesmo de qualquer origem);
 * 2. `message.received` — a mensagem-resumo do formulário, se foi inserida agora;
 * 3. `deal.created` — só o card que ESTE lead criou (lead que cai numa conversa com
 *    card vira nota no histórico, não card novo, então não anuncia).
 *
 * O que é anunciado sai do que a transação de fato gravou (RETURNING / inserção
 * vencedora): rollback não grava nada na outbox; queda do processo depois do commit
 * não perde o aviso; reprocesso do mesmo lead para na trava da submissão, logo não
 * regrava — e o eventId estável deduplica na outbox e no fan-out de qualquer forma.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  answersSummary,
  contactFieldsFrom,
  customFieldsFrom,
  type FunnelFieldDef,
} from '@hm/channels';
import {
  contactIdentitiesRepo,
  decryptSecret,
  enqueueOutbox,
  leadAdsRepo,
  metaConnectionsRepo,
  schema,
  withWorkspace,
  type DbTx,
  type ResolvedLeadSource,
} from '@hm/db';
import { countryCodeForMarket, getMarketPack, normalizeE164 } from '@hm/shared';
import {
  dealCreatedFromRow,
  domainEvents,
  domainEventsOutbox,
  type DealRowForEvent,
  type DomainEventDraft,
} from '@hm/shared/mq';
import type { ClaimResult, LeadgenJob, LeadStore, PersistLeadInput, PersistLeadResult } from './ports';

const {
  channels,
  contacts,
  conversations,
  dealHistory,
  deals,
  messages,
  pipelines,
  stages,
  workspaces,
} = schema;

/** Origem gravada em contato e card. Uma constante: filtros e relatórios dependem dela. */
export const LEAD_ADS_SOURCE = 'meta_lead_ads' as const;

export class DbLeadStore implements LeadStore {

  async resolveSources(pageId: string): Promise<ResolvedLeadSource[]> {
    return leadAdsRepo.resolveSourcesForPage(pageId);
  }

  async claim(source: ResolvedLeadSource, job: LeadgenJob): Promise<ClaimResult> {
    return withWorkspace(source.workspaceId, async (tx) => {
      const reserva = await leadAdsRepo.claimSubmission(tx, {
        workspaceId: source.workspaceId,
        sourceId: source.sourceId,
        leadgenId: job.leadgenId,
        pageId: job.pageId,
        formId: job.formId,
        adId: job.adId,
      });
      if (reserva.alreadyProcessed) {
        return { submissionId: reserva.id, alreadyProcessed: true, connectionToken: null };
      }
      const conexao = await metaConnectionsRepo.getWithToken(tx, source.workspaceId, source.connectionId);
      const token =
        conexao === null || conexao.status !== 'active' || conexao.accessTokenEnc === null
          ? null
          : decryptSecret(conexao.accessTokenEnc, conexao.keyVersion);
      return { submissionId: reserva.id, alreadyProcessed: false, connectionToken: token };
    });
  }

  async fail(source: ResolvedLeadSource, submissionId: string, error: string): Promise<void> {
    await withWorkspace(source.workspaceId, (tx) =>
      leadAdsRepo.failSubmission(tx, { workspaceId: source.workspaceId, id: submissionId, error }),
    );
  }

  async persist(input: PersistLeadInput): Promise<PersistLeadResult> {
    const { source, lead, job, now } = input;
    const workspaceId = source.workspaceId;

    const gravar = async (tx: DbTx): Promise<StoredLead> => {
      const estado = await leadAdsRepo.lockSubmission(tx, workspaceId, input.submissionId);
      if (estado === 'processed' || estado === null) {
        return {
          result: { created: false, contactId: null, conversationId: null, dealId: null, message: null },
          channelId: null,
          opened: false,
          createdDeal: null,
        };
      }

      const [ws] = await tx
        .select({ market: workspaces.market })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      const market = ws?.market ?? 'BR';

      const campos = contactFieldsFrom(lead.answers);
      const e164 = campos.phone === null ? null : normalizeE164(campos.phone, countryCodeForMarket(market));
      const digitos = e164?.slice(1) ?? null;

      const contactId = await ensureLeadContact(tx, workspaceId, {
        phoneDigits: digitos,
        email: campos.email,
        fullName: campos.fullName,
      });

      const resumo = answersSummary(lead.answers);
      const externalId = `leadgen:${lead.leadgenId}`;
      let conversationId: string | null = null;
      let channelId: string | null = null;
      let opened = false;
      let mensagem: PersistLeadResult['message'] = null;

      if (digitos !== null) {
        const [canal] = await tx
          .select({ id: channels.id })
          .from(channels)
          .where(
            and(
              eq(channels.workspaceId, workspaceId),
              eq(channels.provider, 'meta_whatsapp'),
              eq(channels.isActive, true),
            ),
          )
          .orderBy(asc(channels.createdAt))
          .limit(1);

        if (canal !== undefined) {
          const conversa = await ensureLeadConversation(tx, workspaceId, canal.id, digitos, contactId);
          conversationId = conversa.id;
          channelId = canal.id;
          opened = conversa.created;
          const quando = lead.createdTime === null ? now : new Date(lead.createdTime);
          const [msg] = await tx
            .insert(messages)
            .values({
              workspaceId,
              conversationId,
              externalId,
              direction: 'inbound',
              senderType: 'contact',
              type: 'text',
              content: resumo,
              viewStatus: 'delivered',
              providerTimestamp: Number.isNaN(quando.getTime()) ? null : quando,
              metadata: {
                kind: 'lead_ad',
                leadgenId: lead.leadgenId,
                pageId: job.pageId,
                formId: lead.formId ?? job.formId,
                adId: lead.adId ?? job.adId,
              },
            })
            .onConflictDoNothing({
              target: [messages.conversationId, messages.externalId],
              where: sql`${messages.externalId} is not null`,
            })
            .returning({ id: messages.id });

          if (msg !== undefined) {
            mensagem = { id: msg.id, externalId, content: resumo };
            await tx
              .update(conversations)
              .set({
                lastMessagePreview: resumo.slice(0, 140),
                lastMessageAt: now,
                lastMessageFrom: 'contact',
                unreadCount: sql`${conversations.unreadCount} + 1`,
                status: 'open',
                updatedAt: now,
              })
              .where(eq(conversations.id, conversationId));
          }
        }
      }

      const deal = await createLeadDeal(tx, {
        workspaceId,
        contactId,
        conversationId,
        title: campos.fullName ?? e164 ?? campos.email ?? 'Lead do anúncio',
        currency: getMarketPack(market).currency,
        answers: lead.answers,
        origin: {
          leadgenId: lead.leadgenId,
          pageId: job.pageId,
          formId: lead.formId ?? job.formId,
          adId: lead.adId ?? job.adId,
          formName: input.consent.formName,
        },
      });

      await leadAdsRepo.completeSubmission(tx, {
        workspaceId,
        id: input.submissionId,
        leadCreatedAt: lead.createdTime === null ? null : new Date(lead.createdTime),
        formId: lead.formId ?? job.formId,
        adId: lead.adId ?? job.adId,
        answers: Object.fromEntries(Object.entries(lead.answers).map(([k, v]) => [k, [...v]])),
        consent: input.consent,
        contactId,
        conversationId,
        dealId: deal?.id ?? null,
        now,
      });

      return {
        result: { created: true, contactId, conversationId, dealId: deal?.id ?? null, message: mensagem },
        channelId,
        opened,
        createdDeal: deal?.created ?? null,
      };
    };

    // F70-S16: os avisos entram na outbox na MESMA transação do lead.
    const gravado = await withWorkspace(workspaceId, async (tx) => {
      const stored = await gravar(tx);
      await enqueueOutbox(tx, domainEventsOutbox(leadEvents(workspaceId, stored)));
      return stored;
    });
    return gravado.result;
  }
}

/** Resultado da transação + o que ela criou (anunciado pela outbox, na mesma transação). */
interface StoredLead {
  readonly result: PersistLeadResult;
  /** Canal da conversa do lead (`null` = lead sem conversa). */
  readonly channelId: string | null;
  /** A conversa foi inserida por ESTE lead (não existia). */
  readonly opened: boolean;
  /** Card inserido por ESTE lead (`null` = sem card ou card já existente). */
  readonly createdDeal: DealRowForEvent | null;
}

/**
 * Eventos de domínio do lead gravado, na ordem em que as coisas nasceram. Puro:
 * só lê o que a transação devolveu.
 */
function leadEvents(workspaceId: string, stored: StoredLead): DomainEventDraft[] {
  const { result, channelId } = stored;
  const drafts: DomainEventDraft[] = [];
  if (result.conversationId !== null && channelId !== null) {
    if (stored.opened) {
      drafts.push(
        domainEvents.conversationOpened(workspaceId, {
          conversationId: result.conversationId,
          contactId: result.contactId,
          channelId,
          trigger: 'lead_ad',
        }),
      );
    }
    if (result.message !== null) {
      drafts.push(
        domainEvents.messageReceived(workspaceId, {
          conversationId: result.conversationId,
          messageId: result.message.id,
          contactId: result.contactId,
          channelId,
          type: 'text',
          text: result.message.content,
        }),
      );
    }
  }
  if (stored.createdDeal !== null) drafts.push(dealCreatedFromRow(workspaceId, stored.createdDeal));
  return drafts;
}

async function ensureLeadContact(
  tx: DbTx,
  workspaceId: string,
  dados: { phoneDigits: string | null; email: string | null; fullName: string | null },
): Promise<string> {
  let contactId: string | null = null;
  if (dados.phoneDigits !== null) {
    contactId = await contactIdentitiesRepo.resolve(tx, workspaceId, { kind: 'phone', value: dados.phoneDigits });
  }
  if (contactId === null && dados.email !== null) {
    contactId = await contactIdentitiesRepo.resolve(tx, workspaceId, { kind: 'email', value: dados.email });
  }
  if (contactId === null && dados.phoneDigits !== null) {
    const [porTelefone] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          eq(contacts.phone, dados.phoneDigits),
          isNull(contacts.deletedAt),
        ),
      )
      .limit(1);
    contactId = porTelefone?.id ?? null;
  }

  if (contactId === null) {
    const [criado] = await tx
      .insert(contacts)
      .values({
        workspaceId,
        phone: dados.phoneDigits,
        email: dados.email,
        displayName: dados.fullName,
        source: LEAD_ADS_SOURCE,
      })
      .returning({ id: contacts.id });
    if (criado === undefined) throw new Error('leadgen: contato não materializou após insert.');
    contactId = criado.id;
  } else {
    // Contato existente: completa só o que está vazio. Nome e e-mail que o atendente
    // já corrigiu no CRM ganham do que a pessoa digitou no formulário.
    if (dados.fullName !== null) {
      await tx
        .update(contacts)
        .set({ displayName: dados.fullName })
        .where(and(eq(contacts.id, contactId), isNull(contacts.displayName)));
    }
    if (dados.email !== null) {
      await tx
        .update(contacts)
        .set({ email: dados.email })
        .where(and(eq(contacts.id, contactId), isNull(contacts.email)));
    }
  }

  if (dados.phoneDigits !== null) {
    await contactIdentitiesRepo.attach(tx, workspaceId, contactId, { kind: 'phone', value: dados.phoneDigits });
  }
  if (dados.email !== null) {
    await contactIdentitiesRepo.attach(tx, workspaceId, contactId, { kind: 'email', value: dados.email });
  }
  return contactId;
}

async function ensureLeadConversation(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  remoteId: string,
  contactId: string,
): Promise<{ readonly id: string; readonly created: boolean }> {
  const [existente] = await tx
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);
  if (existente !== undefined) {
    if (existente.contactId === null) {
      await tx.update(conversations).set({ contactId }).where(eq(conversations.id, existente.id));
    }
    return { id: existente.id, created: false };
  }

  const [criada] = await tx
    .insert(conversations)
    .values({ workspaceId, channelId, contactId, remoteId, kind: 'direct', status: 'open', aiMode: 'off' })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
    .returning({ id: conversations.id });
  // Só quem de fato inseriu "abriu" a conversa; o perdedor da corrida reseleciona.
  if (criada !== undefined) return { id: criada.id, created: true };

  const [vencedora] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);
  if (vencedora === undefined) throw new Error('leadgen: conversa não materializou após upsert.');
  return { id: vencedora.id, created: false };
}

/**
 * Card no funil padrão, no estágio de entrada.
 *
 * Conversa que já tem card (a pessoa já estava em negociação) não ganha outro: o
 * lead entra como evento no histórico do card existente. Duplicar o card faria o
 * mesmo cliente aparecer duas vezes no funil e contar duas vezes na previsão.
 */
async function createLeadDeal(
  tx: DbTx,
  input: {
    workspaceId: string;
    contactId: string;
    conversationId: string | null;
    title: string;
    currency: string;
    answers: PersistLeadInput['lead']['answers'];
    origin: Record<string, string | null>;
  },
): Promise<{ readonly id: string; readonly created: DealRowForEvent | null } | null> {
  if (input.conversationId !== null) {
    const [existente] = await tx
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.conversationId, input.conversationId))
      .orderBy(desc(deals.createdAt))
      .limit(1);
    if (existente !== undefined) {
      // `note_added` com `kind` no metadata, e não um tipo novo: o CHECK de
      // `deal_history.event_type` e a linha do tempo do card conhecem uma lista
      // fechada de tipos. Um tipo novo exigiria migração e quebraria o rótulo na tela.
      await tx.insert(dealHistory).values({
        dealId: existente.id,
        workspaceId: input.workspaceId,
        eventType: 'note_added',
        actorType: 'system',
        metadata: { kind: 'lead_ad_received', source: LEAD_ADS_SOURCE, ...input.origin },
      });
      return { id: existente.id, created: null };
    }
  }

  const [pipeline] = await tx
    .select({ id: pipelines.id, settings: pipelines.settings })
    .from(pipelines)
    .where(eq(pipelines.isActive, true))
    .orderBy(desc(pipelines.isDefault), pipelines.createdAt)
    .limit(1);
  if (pipeline === undefined) return null;

  const [stage] = await tx
    .select({ id: stages.id })
    .from(stages)
    .where(eq(stages.pipelineId, pipeline.id))
    .orderBy(stages.position)
    .limit(1);
  if (stage === undefined) return null;

  const defs: FunnelFieldDef[] = (pipeline.settings?.custom_fields ?? []).map((d) => ({
    key: d.key,
    type: d.type,
    ...(d.options !== undefined ? { options: d.options } : {}),
  }));

  const [criado] = await tx
    .insert(deals)
    .values({
      workspaceId: input.workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: input.contactId,
      conversationId: input.conversationId,
      title: input.title.slice(0, 200),
      valueCents: 0,
      currency: input.currency,
      source: LEAD_ADS_SOURCE,
      customFields: { ...customFieldsFrom(input.answers, defs), lead_ad: input.origin },
    })
    .onConflictDoNothing({
      target: deals.conversationId,
      where: sql`${deals.conversationId} is not null`,
    })
    .returning({
      id: deals.id,
      pipelineId: deals.pipelineId,
      stageId: deals.stageId,
      contactId: deals.contactId,
      conversationId: deals.conversationId,
      valueCents: deals.valueCents,
      currency: deals.currency,
      closedAt: deals.closedAt,
    });
  if (criado === undefined) return null;

  await tx.insert(dealHistory).values({
    dealId: criado.id,
    workspaceId: input.workspaceId,
    eventType: 'created',
    actorType: 'system',
    metadata: { source: LEAD_ADS_SOURCE, ...input.origin },
  });
  return { id: criado.id, created: criado };
}

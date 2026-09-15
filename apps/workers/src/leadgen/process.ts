/**
 * Processamento de um lead de anúncio (F69-S03).
 *
 * ```
 * job (leadgen_id, página)
 *   → fontes ativas da página (pode haver mais de um workspace)
 *   → para cada uma:
 *       reserva o lead (idempotente)        → já processado? para.
 *       busca o lead na Meta                → falha transitória? lança (retry da fila)
 *                                           → falha definitiva? marca `failed` e segue
 *       busca o termo do formulário         → nunca derruba o lead
 *       grava contato + conversa + card     → numa transação, com trava na linha do lead
 *       emite `message:new`                 → aciona o aviso de lead novo (F61-S04)
 * ```
 *
 * ## Retry x falha definitiva
 *
 * Meta fora do ar, 429 e 5xx são transitórios: o erro sobe, a fila confiável tenta
 * de novo e, esgotada, joga na DLQ — onde o monitor alerta. Token revogado, página
 * sem acesso e lead inexistente não melhoram com retry: o lead fica `failed` com o
 * motivo, visível na tela de configuração, e a reconciliação tenta de novo quando a
 * conexão for refeita. Nos dois casos o lead não some em silêncio.
 */
import { MetaError, type FormDisclaimer, type ParsedLead } from '@hm/channels';
import type { LeadConsentEvidence, ResolvedLeadSource } from '@hm/db';
import { PageAccessError } from './graph-source';
import type { LeadgenDeps, LeadgenJob } from './ports';

export interface LeadgenOutcome {
  readonly workspaceId: string;
  readonly result: 'created' | 'duplicate' | 'failed' | 'no_token';
  readonly conversationId?: string | null;
}

/** Falha que retry não resolve. Tudo que não for isto e lançar é tratado como transitório. */
export function isPermanentFailure(err: unknown): boolean {
  if (err instanceof PageAccessError) return true;
  if (err instanceof MetaError) return !err.retryable && err.httpStatus !== 0;
  return false;
}

function mensagemDe(err: unknown): string {
  if (err instanceof PageAccessError) return err.message;
  if (err instanceof MetaError) {
    if (err.code === 190) return 'O acesso à Meta expirou ou foi removido. Reconecte a Meta.';
    if (err.code === 10 || err.code === 200) {
      return 'A conexão Meta não tem permissão para ler leads (leads_retrieval). Reconecte a Meta.';
    }
    return `A Meta recusou a leitura do lead: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function consentEvidence(
  lead: ParsedLead,
  formId: string | null,
  termo: FormDisclaimer | null,
): LeadConsentEvidence {
  return {
    capturedFrom: 'meta_lead_form',
    formId,
    formName: termo?.formName ?? null,
    disclaimerTitle: termo?.title ?? null,
    disclaimerBody: termo?.body ?? null,
    checkboxes: lead.consent.map((c) => ({
      checkboxKey: c.checkboxKey,
      isChecked: c.isChecked,
      text: termo?.checkboxText[c.checkboxKey] ?? null,
    })),
    submittedAt: lead.createdTime,
  };
}

async function processForSource(
  source: ResolvedLeadSource,
  job: LeadgenJob,
  deps: LeadgenDeps,
): Promise<LeadgenOutcome> {
  const { store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const claim = await store.claim(source, job);
  const base = { workspaceId: source.workspaceId, leadgenId: job.leadgenId, origin: job.origin };

  if (claim.alreadyProcessed) {
    logger.info('leadgen.duplicate', base);
    return { workspaceId: source.workspaceId, result: 'duplicate' };
  }
  if (claim.connectionToken === null) {
    const motivo = 'A conexão Meta desta página foi removida. Reconecte a Meta para receber os leads.';
    await store.fail(source, claim.submissionId, motivo);
    logger.error('leadgen.no_token', base);
    return { workspaceId: source.workspaceId, result: 'no_token' };
  }

  let lead: ParsedLead | null;
  try {
    lead = await deps.source.fetchLead({
      connectionToken: claim.connectionToken,
      pageId: job.pageId,
      leadgenId: job.leadgenId,
    });
  } catch (err) {
    await store.fail(source, claim.submissionId, mensagemDe(err));
    if (!isPermanentFailure(err)) {
      // Transitório: sobe para a fila tentar de novo. A linha fica `failed` com o
      // motivo até a próxima tentativa dar certo — visível, não silenciosa.
      logger.warn('leadgen.fetch.retry', { ...base, error: mensagemDe(err) });
      throw err;
    }
    logger.error('leadgen.fetch.failed', { ...base, error: mensagemDe(err) });
    return { workspaceId: source.workspaceId, result: 'failed' };
  }

  if (lead === null) {
    await store.fail(source, claim.submissionId, 'A Meta não devolveu o lead (resposta sem id).');
    logger.error('leadgen.fetch.empty', base);
    return { workspaceId: source.workspaceId, result: 'failed' };
  }

  const formId = lead.formId ?? job.formId;
  const termo =
    formId === null
      ? null
      : await deps.source.fetchDisclaimer({
          connectionToken: claim.connectionToken,
          pageId: job.pageId,
          formId,
        });

  const gravado = await store.persist({
    source,
    submissionId: claim.submissionId,
    job,
    lead,
    consent: consentEvidence(lead, formId, termo),
    now: now(),
  });

  if (!gravado.created) {
    logger.info('leadgen.duplicate.concurrent', base);
    return { workspaceId: source.workspaceId, result: 'duplicate' };
  }

  if (gravado.conversationId !== null && gravado.message !== null) {
    try {
      await deps.socket.emitMessageNew({
        workspaceId: source.workspaceId,
        conversationId: gravado.conversationId,
        messageId: gravado.message.id,
        externalId: gravado.message.externalId,
        type: 'text',
        content: gravado.message.content,
      });
    } catch (err) {
      // O lead já está gravado. Falha no aviso ao vivo não pode desfazer nem repetir
      // a gravação; a inbox mostra o lead no próximo carregamento.
      logger.warn('leadgen.socket.failed', { ...base, error: mensagemDe(err) });
    }
  }

  logger.info('leadgen.created', {
    ...base,
    conversation: gravado.conversationId !== null,
    deal: gravado.dealId !== null,
  });
  return { workspaceId: source.workspaceId, result: 'created', conversationId: gravado.conversationId };
}

/**
 * Processa um lead para todo workspace que recebe leads desta página.
 *
 * Uma falha transitória em um workspace não impede os outros: todos rodam, e o erro
 * sobe no fim para a fila repetir. No retry, quem já gravou é `duplicate` — sem
 * contato nem card em dobro.
 */
export async function processLeadgenJob(job: LeadgenJob, deps: LeadgenDeps): Promise<LeadgenOutcome[]> {
  const fontes = await deps.store.resolveSources(job.pageId);
  if (fontes.length === 0) {
    deps.logger.warn('leadgen.no_source', { pageId: job.pageId, leadgenId: job.leadgenId });
    return [];
  }

  const resultados: LeadgenOutcome[] = [];
  let transitorio: unknown = null;
  for (const fonte of fontes) {
    try {
      resultados.push(await processForSource(fonte, job, deps));
    } catch (err) {
      transitorio ??= err;
    }
  }
  if (transitorio !== null) throw transitorio;
  return resultados;
}

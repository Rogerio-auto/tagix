/**
 * Portas do worker de leads de anúncios (F69-S03).
 *
 * O processamento (`process.ts`) só conhece estas interfaces. A Meta e o banco
 * entram por implementações (`graph-source.ts`, `db-store.ts`), e os testes trocam
 * as duas por fakes — é o que permite testar retry, duplicidade e falha sem rede.
 */
import type { FormDisclaimer, ParsedLead } from '@hm/channels';
import type { LeadConsentEvidence, ResolvedLeadSource } from '@hm/db';

/** O que chega na fila: a notificação do webhook ou um lead achado na reconciliação. */
export interface LeadgenJob {
  readonly leadgenId: string;
  readonly pageId: string;
  readonly formId: string | null;
  readonly adId: string | null;
  /** De onde veio. Só para log e métrica: o processamento é o mesmo. */
  readonly origin: 'webhook' | 'reconciliation';
}

/** Leitura na Meta. Lança `MetaError` — quem chama decide se é retry ou falha definitiva. */
export interface LeadSource {
  fetchLead(input: { connectionToken: string; pageId: string; leadgenId: string }): Promise<ParsedLead | null>;
  /** Termo do formulário. Nunca lança: sem o termo, o lead chega mesmo assim. */
  fetchDisclaimer(input: { connectionToken: string; pageId: string; formId: string }): Promise<FormDisclaimer | null>;
}

export interface ClaimResult {
  readonly submissionId: string;
  readonly alreadyProcessed: boolean;
  /** Token de usuário decifrado da conexão; `null` = conexão revogada ou sem token. */
  readonly connectionToken: string | null;
}

export interface PersistLeadInput {
  readonly source: ResolvedLeadSource;
  readonly submissionId: string;
  readonly job: LeadgenJob;
  readonly lead: ParsedLead;
  readonly consent: LeadConsentEvidence;
  readonly now: Date;
}

export interface PersistLeadResult {
  /** `false` quando outra execução gravou primeiro — nada foi criado agora. */
  readonly created: boolean;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly dealId: string | null;
  /** Mensagem inserida na conversa, para o `message:new`. */
  readonly message: { readonly id: string; readonly externalId: string; readonly content: string } | null;
}

export interface LeadStore {
  resolveSources(pageId: string): Promise<ResolvedLeadSource[]>;
  claim(source: ResolvedLeadSource, job: LeadgenJob): Promise<ClaimResult>;
  persist(input: PersistLeadInput): Promise<PersistLeadResult>;
  fail(source: ResolvedLeadSource, submissionId: string, error: string): Promise<void>;
}

/** Aviso de mensagem nova — o mesmo `message:new` do inbound, que aciona o aviso de lead. */
export interface LeadSocket {
  emitMessageNew(input: {
    workspaceId: string;
    conversationId: string;
    messageId: string;
    externalId: string;
    type: string;
    content: string | null;
  }): Promise<void>;
}

export interface LeadgenLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LeadgenDeps {
  readonly store: LeadStore;
  readonly source: LeadSource;
  readonly socket: LeadSocket;
  readonly logger: LeadgenLogger;
  readonly now?: () => Date;
}

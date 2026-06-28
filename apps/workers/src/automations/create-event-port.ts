/**
 * Port `create_event` das automacoes de stage (F53-S07).
 *
 * Liga a action `create_event` (PIPELINE.md 3.1) ao NUCLEO UNICO de persistencia
 * de eventos — `@hm/db.calendarRepo.createEvent` (extraido em F53-S08). NAO duplica
 * o insert de evento: monta o `CreateEventInput` a partir do contexto da automacao
 * e delega ao repo dentro de uma transacao RLS-escopada (GUC `app.workspace_id`
 * preenchido por `withWorkspace` — F40-S01).
 *
 * As dependencias (scope RLS, lookup do deal, criacao) sao INJETADAS para o port
 * ser testavel sem DB; `liveCreateEventPortDeps()` faz o wiring real com `@hm/db`
 * e e o que o bootstrap usa.
 *
 * Contrato do `config` (espelha `@hm/db` AutomationRuleConfig p/ `create_event`):
 *   `{ calendarId, title, durationMinutes, offsetDays }`. O `offsetDays` define o
 *   inicio relativo ("daqui N dias", a partir de agora) e `durationMinutes` a duracao.
 *   `type`/`priority` nao vivem no config persistido (schema da rule e travado em
 *   `@hm/db`, fora da fronteira deste slot) → caem nos defaults do repo
 *   (`type='meeting'`, `priority='medium'`). Quando a rule ganhar esses campos,
 *   basta repassa-los aqui.
 */
import { calendarRepo, schema, withWorkspace, type CreateEventInput, type DbTx, type Event } from '@hm/db';
import { eq } from 'drizzle-orm';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Config persistido da action `create_event` (sem o discriminante `kind`). */
export interface CreateEventConfig {
  readonly calendarId: string;
  readonly title: string;
  readonly durationMinutes: number;
  readonly offsetDays: number;
}

/** Contexto da automacao (o que o executor passa ao port). */
export interface CreateEventPortCtx {
  readonly workspaceId: string;
  readonly dealId: string;
}

/** Referencia do deal resolvida sob a tx escopada (contato/conversa do compromisso). */
export interface DealEventRef {
  readonly contactId: string | null;
  readonly conversationId: string | null;
}

export interface CreateEventPortDeps {
  /** Roda `fn` sob RLS-scope do workspace (GUC `app.workspace_id` preenchido). */
  readonly runScoped: <T>(workspaceId: string, fn: (tx: DbTx) => Promise<T>) => Promise<T>;
  /** Resolve contato/conversa do deal (sob a tx); `null` se o deal sumiu. */
  readonly resolveDeal: (tx: DbTx, dealId: string) => Promise<DealEventRef | null>;
  /** Nucleo unico de criacao de evento — reusado da API (`@hm/db`). */
  readonly createEvent: (tx: DbTx, input: CreateEventInput) => Promise<Event>;
  /** Relogio injetavel (testes deterministicos de offset). Default: `Date`. */
  readonly now?: () => Date;
}

/** Tipo do port `createEvent` consumido pelo executor das automacoes. */
export type CreateEventPort = (ctx: CreateEventPortCtx, config: CreateEventConfig) => Promise<void>;

/**
 * Constroi o port `create_event` a partir das dependencias injetadas. Resolve
 * `startAt = agora + offsetDays` e `endAt = startAt + durationMinutes`, deriva
 * contato/conversa do deal e delega ao nucleo de criacao. `createdBy`/
 * `createdByAgentId` ficam `null` = autor SISTEMA/AUTOMACAO (a API resolveria do
 * actor humano/agente). Se o deal nao existe mais, no-op idempotente.
 */
export function createCalendarEventPort(deps: CreateEventPortDeps): CreateEventPort {
  const clock = deps.now ?? ((): Date => new Date());
  return async (ctx, config) => {
    const startAt = new Date(clock().getTime() + config.offsetDays * DAY_MS);
    const endAt = new Date(startAt.getTime() + config.durationMinutes * MINUTE_MS);
    await deps.runScoped(ctx.workspaceId, async (tx) => {
      const deal = await deps.resolveDeal(tx, ctx.dealId);
      if (!deal) return;
      const input: CreateEventInput = {
        workspaceId: ctx.workspaceId,
        // `''` (sem calendar explicito) → repo cai no calendario "Empresa" (default).
        calendarId: config.calendarId.length > 0 ? config.calendarId : null,
        title: config.title,
        startAt,
        endAt,
        contactId: deal.contactId,
        conversationId: deal.conversationId,
        dealId: ctx.dealId,
        // Autor = sistema/automacao (sem member/agente humano).
        createdBy: null,
        createdByAgentId: null,
        metadata: { source: 'automation', ruleKind: 'create_event' },
      };
      await deps.createEvent(tx, input);
    });
  };
}

/**
 * Wiring real do port com `@hm/db`: scope via `withWorkspace`, lookup do deal sob
 * a mesma tx e delegacao a `calendarRepo.createEvent`. Usado pelo bootstrap.
 */
export function liveCreateEventPortDeps(): CreateEventPortDeps {
  return {
    runScoped: (workspaceId, fn) => withWorkspace(workspaceId, fn),
    resolveDeal: async (tx, dealId) => {
      const [deal] = await tx
        .select({
          contactId: schema.deals.contactId,
          conversationId: schema.deals.conversationId,
        })
        .from(schema.deals)
        .where(eq(schema.deals.id, dealId))
        .limit(1);
      return deal ? { contactId: deal.contactId, conversationId: deal.conversationId } : null;
    },
    createEvent: (tx, input) => calendarRepo.createEvent(tx, input),
  };
}

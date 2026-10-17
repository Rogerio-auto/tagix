/**
 * Modelos de texto do briefing (v1: determinístico, sem LLM; COPILOTO.md §7.1 e §10).
 *
 * Duas famílias: `pt` (pt-BR) e `en`. Números e moeda saem de `Intl` com o locale do
 * workspace (nunca de literal: F59-S08); só as FRASES variam por família. Locale que não é
 * português cai em inglês. Nenhum modelo recebe nome de contato: o briefing é para ser lido
 * no ombro de alguém (balão, push) sem expor cliente.
 */
import { getMarketPack } from '@hm/shared';
import { makeFormatters, type WorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import { BRIEFING_CAMPAIGN_REACH_RATE, type CandidateFacts } from './types';

export type TextFamily = 'pt' | 'en';

export function textFamily(locale: string): TextFamily {
  return locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** Formatadores `Intl` do workspace + o que os modelos precisam além do `common`. */
export interface TextKit {
  readonly family: TextFamily;
  readonly locale: string;
  money(units: number): string;
  count(n: number): string;
  /** Até 2 casas, sem zeros à direita ("1,25", "6,5", "2"). */
  decimal(n: number): string;
  percent(fraction: number): string;
}

/** Locale do workspace se o `Intl` o aceita; senão o padrão do mercado (nunca lança depois). */
function usableLocale(fmt: WorkspaceFormat): string {
  try {
    new Intl.NumberFormat(fmt.locale);
    return fmt.locale;
  } catch {
    return getMarketPack(fmt.currency === 'USD' ? 'US' : 'BR').defaultLocale;
  }
}

export function makeTextKit(source: WorkspaceFormat): TextKit {
  const fmt: WorkspaceFormat = { ...source, locale: usableLocale(source) };
  const base = makeFormatters(fmt);
  let decimal: Intl.NumberFormat;
  try {
    decimal = new Intl.NumberFormat(fmt.locale, { maximumFractionDigits: 2 });
  } catch {
    decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  }
  return {
    family: textFamily(fmt.locale),
    locale: fmt.locale,
    money: base.money,
    count: base.count,
    decimal: (n) => decimal.format(n),
    percent: base.percent,
  };
}

function plural(kit: TextKit, n: number, one: string, other: string): string {
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(kit.locale);
  } catch {
    rules = new Intl.PluralRules('en-US');
  }
  return rules.select(n) === 'one' ? one : other;
}

/** Duração curta: minutos até 2 h (90 min é "90 min", não "2 h"), horas inteiras acima. */
function duration(kit: TextKit, minutes: number): string {
  if (minutes < 120) return `${kit.count(Math.max(1, Math.round(minutes)))} min`;
  const hours = Math.round(minutes / 60);
  return `${kit.count(hours)} h`;
}

export interface ItemTexts {
  readonly title: string;
  readonly why: readonly string[];
  readonly actionLabel: string;
  /** Pedido pronto para o Copiloto, quando a ação é `ask`. */
  readonly ask: string | null;
}

/** Peso formatado ("×1,25"). */
function times(kit: TextKit, weight: number): string {
  return `×${kit.decimal(weight)}`;
}

type Facts<K extends CandidateFacts['kind']> = Extract<CandidateFacts, { kind: K }>;

interface Score {
  readonly value: number;
  readonly weight: number;
}

function dealsIdle(kit: TextKit, f: Facts<'deals_idle'>, s: Score): ItemTexts {
  const pt = kit.family === 'pt';
  const noun = pt
    ? plural(kit, f.count, 'negócio', 'negócios')
    : plural(kit, f.count, 'deal', 'deals');
  const head = pt
    ? `${kit.count(f.count)} ${noun} sem resposta há ${kit.count(f.idleDaysThreshold)}+ dias`
    : `${kit.count(f.count)} ${noun} with no reply for ${kit.count(f.idleDaysThreshold)}+ days`;
  const title = pt
    ? `${head} · ${kit.money(s.value)} em ${f.stageName}`
    : `${head} · ${kit.money(s.value)} in ${f.stageName}`;
  const why = pt
    ? [
        `${kit.money(s.value)} em ${kit.count(f.count)} ${noun}`,
        `O mais antigo está parado há ${kit.count(f.maxIdleDays)} dias (média de ${kit.decimal(f.avgIdleDays)}); peso ${times(kit, s.weight)}`,
      ]
    : [
        `${kit.money(s.value)} across ${kit.count(f.count)} ${noun}`,
        `The oldest has been idle for ${kit.count(f.maxIdleDays)} days (average ${kit.decimal(f.avgIdleDays)}); weight ${times(kit, s.weight)}`,
      ];
  const target = f.reactivationStageName;
  if (target) {
    return {
      title,
      why,
      actionLabel: pt ? `Mover para ${target}` : `Move to ${target}`,
      ask: pt
        ? `Mover os negócios parados há ${f.idleDaysThreshold} dias ou mais em ${f.stageName} para ${target}`
        : `Move the deals idle for ${f.idleDaysThreshold} days or more in ${f.stageName} to ${target}`,
    };
  }
  return { title, why, actionLabel: pt ? 'Ver no pipeline' : 'Open in pipeline', ask: null };
}

function leadsWaiting(kit: TextKit, f: Facts<'leads_waiting'>, s: Score): ItemTexts {
  const pt = kit.family === 'pt';
  const noun = pt
    ? plural(kit, f.count, 'conversa', 'conversas')
    : plural(kit, f.count, 'conversation', 'conversations');
  const wait = duration(kit, f.oldestWaitingMinutes);
  const title = pt
    ? `${kit.count(f.count)} ${noun} esperando resposta, a mais antiga há ${wait}`
    : `${kit.count(f.count)} ${noun} waiting for a reply, the oldest for ${wait}`;
  let basis: string;
  if (f.ticketBasis === 'won_90d') {
    basis = pt
      ? `${kit.count(f.count)} × ticket médio de ${kit.money(f.ticket)} (ganhos dos últimos 90 dias)`
      : `${kit.count(f.count)} × average ticket of ${kit.money(f.ticket)} (wins in the last 90 days)`;
  } else if (f.ticketBasis === 'open') {
    basis = pt
      ? `${kit.count(f.count)} × ${kit.money(f.ticket)} (média dos negócios em aberto; sem ganhos recentes)`
      : `${kit.count(f.count)} × ${kit.money(f.ticket)} (average of open deals; no recent wins)`;
  } else {
    basis = pt
      ? `${kit.count(f.count)} conversas; sem histórico de ticket para estimar o valor`
      : `${kit.count(f.count)} conversations; no ticket history to estimate the value`;
  }
  const why = [
    basis,
    pt
      ? `A mais antiga espera há ${wait}; peso ${times(kit, s.weight)}`
      : `The oldest has waited ${wait}; weight ${times(kit, s.weight)}`,
  ];
  return { title, why, actionLabel: pt ? 'Responder agora' : 'Reply now', ask: null };
}

function eventsToday(kit: TextKit, f: Facts<'events_today'>, s: Score): ItemTexts {
  const pt = kit.family === 'pt';
  const noun = pt
    ? plural(kit, f.count, 'compromisso', 'compromissos')
    : plural(kit, f.count, 'appointment', 'appointments');
  const head = pt
    ? `${kit.count(f.count)} ${noun} de hoje sem confirmação`
    : `${kit.count(f.count)} ${noun} today without confirmation`;
  const title =
    s.value > 0
      ? pt
        ? `${head} · ${kit.money(s.value)} em negócios ligados`
        : `${head} · ${kit.money(s.value)} in linked deals`
      : head;
  const hours = f.hoursUntilFirst;
  const first =
    hours < 1
      ? pt
        ? 'O primeiro começa em menos de 1 h'
        : 'The first one starts in under 1 h'
      : pt
        ? `O primeiro começa em ${kit.decimal(Math.round(hours * 10) / 10)} h`
        : `The first one starts in ${kit.decimal(Math.round(hours * 10) / 10)} h`;
  const why: string[] = [
    pt
      ? `${kit.count(f.count)} ${noun} sem confirmação hoje`
      : `${kit.count(f.count)} ${noun} unconfirmed today`,
  ];
  if (f.dealCount > 0) {
    why.push(
      pt
        ? `${kit.count(f.dealCount)} ${plural(kit, f.dealCount, 'negócio ligado soma', 'negócios ligados somam')} ${kit.money(s.value)}`
        : `${kit.count(f.dealCount)} linked ${plural(kit, f.dealCount, 'deal totals', 'deals total')} ${kit.money(s.value)}`,
    );
  }
  why.push(`${first}; ${pt ? 'peso' : 'weight'} ${times(kit, s.weight)}`);
  return { title, why, actionLabel: pt ? 'Ver agenda' : 'Open calendar', ask: null };
}

function autopilotPending(kit: TextKit, f: Facts<'autopilot_pending'>, s: Score): ItemTexts {
  const pt = kit.family === 'pt';
  const noun = pt
    ? plural(kit, f.count, 'sugestão', 'sugestões')
    : plural(kit, f.count, 'suggestion', 'suggestions');
  const title =
    s.value > 0
      ? pt
        ? `${kit.count(f.count)} ${noun} do piloto automático para aprovar · ${kit.money(s.value)}`
        : `${kit.count(f.count)} autopilot ${noun} to approve · ${kit.money(s.value)}`
      : pt
        ? `${kit.count(f.count)} ${noun} do piloto automático para aprovar`
        : `${kit.count(f.count)} autopilot ${noun} to approve`;
  const why = [
    pt
      ? `${kit.count(f.count)} ${noun} aguardando a sua aprovação`
      : `${kit.count(f.count)} ${noun} waiting for your approval`,
    pt
      ? `${kit.money(s.value)} em negócios envolvidos; peso ${times(kit, s.weight)}`
      : `${kit.money(s.value)} in the deals involved; weight ${times(kit, s.weight)}`,
  ];
  return { title, why, actionLabel: pt ? 'Revisar sugestões' : 'Review suggestions', ask: null };
}

function campaignIssue(kit: TextKit, f: Facts<'campaign_issue'>, s: Score): ItemTexts {
  const pt = kit.family === 'pt';
  const failures = pt
    ? plural(kit, f.failed, 'falha', 'falhas')
    : plural(kit, f.failed, 'failure', 'failures');
  const name = f.campaignName.length > 80 ? `${f.campaignName.slice(0, 79)}…` : f.campaignName;
  const title = pt
    ? `Campanha “${name}” com ${kit.count(f.failed)} ${failures} de envio`
    : `Campaign “${name}” with ${kit.count(f.failed)} send ${failures}`;
  const health = pt
    ? f.health === 'critical'
      ? 'crítica'
      : 'em alerta'
    : f.health === 'critical'
      ? 'critical'
      : 'warning';
  const why = pt
    ? [
        `${kit.count(f.sent)} de ${kit.count(f.total)} enviadas, ${kit.count(f.failed)} falharam`,
        `${kit.count(f.pending)} pendentes × ${kit.money(f.ticket)} × ${kit.percent(BRIEFING_CAMPAIGN_REACH_RATE)} = ${kit.money(s.value)} estimados`,
        `Saúde ${health}; peso ${times(kit, s.weight)}`,
      ]
    : [
        `${kit.count(f.sent)} of ${kit.count(f.total)} sent, ${kit.count(f.failed)} failed`,
        `${kit.count(f.pending)} pending × ${kit.money(f.ticket)} × ${kit.percent(BRIEFING_CAMPAIGN_REACH_RATE)} = ${kit.money(s.value)} estimated`,
        `Health ${health}; weight ${times(kit, s.weight)}`,
      ];
  return { title, why, actionLabel: pt ? 'Ver campanha' : 'Open campaign', ask: null };
}

/** O texto do item. `integration_alert` já chega escrito pelo provedor. */
export function renderItemTexts(kit: TextKit, facts: CandidateFacts, score: Score): ItemTexts {
  switch (facts.kind) {
    case 'deals_idle':
      return dealsIdle(kit, facts, score);
    case 'leads_waiting':
      return leadsWaiting(kit, facts, score);
    case 'events_today':
      return eventsToday(kit, facts, score);
    case 'autopilot_pending':
      return autopilotPending(kit, facts, score);
    case 'campaign_issue':
      return campaignIssue(kit, facts, score);
    case 'integration_alert':
      return {
        title: facts.title,
        why: facts.why,
        actionLabel: facts.action.label,
        ask: facts.action.kind === 'ask' ? facts.action.value : null,
      };
  }
}

/** Título do push da manhã ("Briefing do dia: 3 itens"). */
export function pushTitle(kit: TextKit, itemCount: number): string {
  const pt = kit.family === 'pt';
  const noun = pt
    ? plural(kit, itemCount, 'item', 'itens')
    : plural(kit, itemCount, 'item', 'items');
  return pt
    ? `Briefing do dia: ${kit.count(itemCount)} ${noun}`
    : `Daily briefing: ${kit.count(itemCount)} ${noun}`;
}

/** Fonte exibida de cada tipo (curta; o contrato aceita até 120). */
export function sourceLabel(family: TextFamily, kind: CandidateFacts['kind']): string {
  const pt = family === 'pt';
  switch (kind) {
    case 'deals_idle':
      return 'Pipeline';
    case 'leads_waiting':
      return pt ? 'Caixa de entrada' : 'Inbox';
    case 'events_today':
      return pt ? 'Agenda' : 'Calendar';
    case 'autopilot_pending':
      return pt ? 'Piloto automático' : 'Autopilot';
    case 'campaign_issue':
      return pt ? 'Campanhas' : 'Campaigns';
    case 'integration_alert':
      return pt ? 'Integrações' : 'Integrations';
  }
}

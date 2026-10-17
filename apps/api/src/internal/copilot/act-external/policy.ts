/**
 * Checagem de política do nível 4 (ADR-004 §5; COPILOTO.md §6.4) — F73-S09.
 *
 * Linhas `{ key, status: 'ok'|'warn'|'block', label, detail }`. `block` desabilita o confirmar
 * (o motor recusa com 409 `policy_blocked`), e a checagem é RECALCULADA no confirmar: tudo aqui
 * nasce de uma leitura do banco feita agora (`evaluateRecipients`, `loadCampaignProgress`),
 * nunca do que foi gravado na proposta.
 *
 * Mensagens:
 * - `send_window`: horário do mercado (`markets.ts`: janela legal no fuso do CONTATO, via
 *   `decideOutbound`) e do workspace (hora local; fora do horário comercial = aviso);
 * - `consent`: `checkOutboundInTx` por destinatário; quem não pode receber é PULADO
 *   ("11 de 12 · 1 será pulado");
 * - `window_24h`: conversa fechada há mais de 24 h exige modelo aprovado; texto livre = `block`;
 * - `template_approved`: nome do modelo e status;
 * - `variables` / `recipients`: quem será pulado por variável sem valor ou sem conversa;
 * - `schedule`: agendamento pedido e ainda inexistente (sai no confirmar).
 * "Saldo de mensagens" não entra: o conceito não existe no produto (spec §11.1).
 *
 * Campanha: `campaign_status`, `already_sent`, `scheduled` e `cost_used` (este só para quem tem
 * `agent.view_costs`; o valor é `null` hoje porque não há custo por campanha no banco).
 *
 * Os textos não citam contato (só contagens): a política vai para a Atividade.
 */
import type { PolicyCheck } from '@hm/shared';
import { localHourIn } from '@hm/shared';
import type { CampaignProgress } from '../../../services/campaigns/lifecycle';
import type { SendMessagesArgs } from './message-args';
import type { EvaluationContext, RecipientEvaluation } from './recipients';

/**
 * Horário comercial de referência na hora LOCAL do workspace. O produto não tem horário de
 * funcionamento por workspace; fora desta faixa a linha avisa (nunca bloqueia: a regra legal é a
 * do mercado, no fuso do contato).
 */
export const BUSINESS_HOURS = { startHour: 8, endHour: 21 } as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function hhmm(at: Date, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

function count(
  items: readonly RecipientEvaluation[],
  pred: (i: RecipientEvaluation) => boolean,
): number {
  let n = 0;
  for (const i of items) if (pred(i)) n++;
  return n;
}

function cityOf(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/** Linhas de política de `message.send`. */
export function messagePolicy(
  args: SendMessagesArgs,
  context: EvaluationContext,
  items: readonly RecipientEvaluation[],
  now: Date,
): PolicyCheck[] {
  const total = items.length;
  const checks: PolicyCheck[] = [];
  const sending = count(items, (i) => i.skip === null);
  const reachable = items.filter(
    (i) =>
      i.skip === null ||
      (i.skip.kind !== 'no_conversation' &&
        i.skip.kind !== 'template' &&
        i.skip.kind !== 'unsupported_channel'),
  );

  // Janela de envio: horário legal do mercado (fuso do contato) + hora local do workspace.
  const quiet = count(items, (i) => i.skip?.kind === 'quiet_hours');
  const tz = context.workspace.timezone;
  let localHour = 12;
  try {
    localHour = localHourIn(tz, now);
  } catch {
    localHour = 12;
  }
  const local = `${hhmm(now, tz, context.workspace.locale)} em ${cityOf(tz)}`;
  const inBusiness = localHour >= BUSINESS_HOURS.startHour && localHour < BUSINESS_HOURS.endHour;
  if (quiet > 0 && quiet === reachable.length) {
    checks.push({
      key: 'send_window',
      status: 'block',
      label: 'Janela de envio',
      detail: `Todos fora da janela de horário permitida no fuso de cada contato (agora ${local}).`,
    });
  } else if (quiet > 0) {
    checks.push({
      key: 'send_window',
      status: 'warn',
      label: 'Janela de envio',
      detail: `${quiet} de ${reachable.length} fora da janela de horário do contato · ${plural(quiet, 'será pulado', 'serão pulados')}.`,
    });
  } else if (!inBusiness) {
    checks.push({
      key: 'send_window',
      status: 'warn',
      label: 'Janela de envio',
      detail: `Fora do horário comercial (${local}). A mensagem chega agora.`,
    });
  } else {
    checks.push({
      key: 'send_window',
      status: 'ok',
      label: 'Janela de envio',
      detail: `Dentro do horário comercial (${local}).`,
    });
  }

  // Consentimento (portão da F59, por destinatário). Quem não pode receber é pulado.
  const denied = count(items, (i) => i.skip?.kind === 'consent');
  const checked = reachable.length;
  const purposes = new Set(reachable.map((i) => i.purpose));
  const purposeLabel =
    purposes.size > 1
      ? 'transacional ou marketing, por canal'
      : purposes.has('marketing')
        ? 'marketing'
        : 'transacional';
  if (checked > 0 && denied === checked) {
    checks.push({
      key: 'consent',
      status: 'block',
      label: 'Consentimento',
      detail: `Nenhum dos ${checked} pode receber (mensagem ${purposeLabel}).`,
    });
  } else if (denied > 0) {
    checks.push({
      key: 'consent',
      status: 'warn',
      label: 'Consentimento',
      detail: `${checked - denied} de ${checked} · ${plural(denied, 'será pulado', 'serão pulados')} (mensagem ${purposeLabel}).`,
    });
  } else {
    checks.push({
      key: 'consent',
      status: 'ok',
      label: 'Consentimento',
      detail: `${checked} de ${checked} podem receber (mensagem ${purposeLabel}).`,
    });
  }

  // Janela de 24 h: texto livre não reabre conversa fechada.
  const closed = count(items, (i) => i.skip?.kind === 'window_closed');
  if (args.content.kind === 'text') {
    checks.push(
      closed > 0
        ? {
            key: 'window_24h',
            status: 'block',
            label: 'Conversa de 24 h',
            detail: `${plural(closed, 'conversa fechada', 'conversas fechadas')} há mais de 24 h: texto livre não sai. Use um modelo aprovado.`,
          }
        : {
            key: 'window_24h',
            status: 'ok',
            label: 'Conversa de 24 h',
            detail:
              'Todas as conversas estão abertas (última mensagem do contato há menos de 24 h).',
          },
    );
  } else {
    checks.push({
      key: 'window_24h',
      status: context.templateProblem === null ? 'ok' : 'block',
      label: 'Conversa de 24 h',
      detail:
        context.templateProblem === null
          ? 'Modelo aprovado: reabre conversas fechadas há mais de 24 h.'
          : 'Sem modelo aprovado, conversas fechadas há mais de 24 h não recebem.',
    });
  }

  // Modelo aprovado (catálogo da F58).
  if (args.content.kind === 'template') {
    const t = context.template;
    checks.push(
      context.templateProblem === null && t
        ? {
            key: 'template_approved',
            status: 'ok',
            label: 'Modelo aprovado',
            detail: `"${t.name.slice(0, 80)}" · ${t.status} (${t.category}).`,
          }
        : {
            key: 'template_approved',
            status: 'block',
            label: 'Modelo aprovado',
            detail: (context.templateProblem ?? 'Modelo indisponível.').slice(0, 500),
          },
    );
  }

  // Variáveis sem valor: o destinatário é pulado (nunca mensagem com buraco).
  const missing = items.filter((i) => i.skip?.kind === 'variable');
  if (missing.length > 0) {
    const reasons = [...new Set(missing.map((i) => i.skip?.reason ?? ''))].filter(Boolean);
    checks.push({
      key: 'variables',
      status: 'warn',
      label: 'Variáveis',
      detail:
        `${missing.length} de ${total} ${reasons.join(', ')} · ${plural(missing.length, 'será pulado', 'serão pulados')}.`.slice(
          0,
          500,
        ),
    });
  }

  // Sem conversa visível (ou canal sem envio): pulados.
  const noConversation = count(
    items,
    (i) => i.skip?.kind === 'no_conversation' || i.skip?.kind === 'unsupported_channel',
  );
  if (sending === 0) {
    checks.push({
      key: 'recipients',
      status: 'block',
      label: 'Destinatários',
      detail: `Ninguém receberia esta mensagem (${total} ${total === 1 ? 'pulado' : 'pulados'}).`,
    });
  } else if (noConversation > 0) {
    checks.push({
      key: 'recipients',
      status: 'warn',
      label: 'Destinatários',
      detail: `${noConversation} de ${total} sem conversa que você vê · ${plural(noConversation, 'será pulado', 'serão pulados')}.`,
    });
  } else {
    checks.push({
      key: 'recipients',
      status: 'ok',
      label: 'Destinatários',
      detail: `${sending} de ${total} recebem a mensagem.`,
    });
  }

  // Agendamento pedido: não existe para mensagem individual (decisão do F73-S09).
  if (args.send_at !== undefined) {
    const at = new Date(args.send_at);
    const label = Number.isNaN(at.getTime())
      ? args.send_at
      : `${hhmm(at, tz, context.workspace.locale)} de ${new Intl.DateTimeFormat(context.workspace.locale, { timeZone: tz, day: '2-digit', month: '2-digit' }).format(at)}`;
    checks.push({
      key: 'schedule',
      status: 'warn',
      label: 'Agendamento',
      detail: `Envio agendado ainda não existe: a mensagem sai ao confirmar, não às ${label}.`,
    });
  }
  return checks;
}

/** Ação de ciclo de vida da campanha. */
export type CampaignAction = 'pause' | 'resume' | 'cancel';

const VALID_FROM: Readonly<Record<CampaignAction, readonly string[]>> = {
  pause: ['running', 'scheduled'],
  resume: ['paused'],
  cancel: ['scheduled', 'running', 'paused'],
};

export const CAMPAIGN_STATUS_LABEL: Readonly<Record<string, string>> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Enviando',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export function campaignStatusLabel(status: string): string {
  return CAMPAIGN_STATUS_LABEL[status] ?? status;
}

export function isValidCampaignTransition(action: CampaignAction, status: string): boolean {
  return VALID_FROM[action].includes(status);
}

/** Linhas de política de `campaign.pause|resume|cancel`. */
export function campaignPolicy(
  action: CampaignAction,
  progress: CampaignProgress,
  options: { readonly canSeeCosts: boolean },
): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  const valid = isValidCampaignTransition(action, progress.status);
  checks.push({
    key: 'campaign_status',
    status: valid ? 'ok' : 'block',
    label: 'Status da campanha',
    detail: valid
      ? `${campaignStatusLabel(progress.status)} agora.`
      : `${campaignStatusLabel(progress.status)}: não dá para ${action === 'pause' ? 'pausar' : action === 'resume' ? 'retomar' : 'cancelar'} neste status.`,
  });
  const ofTotal = progress.recipients > 0 ? ` de ${progress.recipients}` : '';
  checks.push({
    key: 'already_sent',
    status: action === 'cancel' && progress.alreadySent > 0 ? 'warn' : 'ok',
    label: 'Já enviadas',
    detail: `${progress.alreadySent}${ofTotal} já saíram e não voltam.`,
  });
  checks.push({
    key: 'scheduled',
    status: action === 'cancel' && progress.scheduled > 0 ? 'warn' : 'ok',
    label: 'Agendadas',
    detail:
      action === 'cancel'
        ? `${progress.scheduled} ainda iam sair; com o cancelamento, não saem mais.`
        : action === 'pause'
          ? `${progress.scheduled} ficam retidas até retomar.`
          : `${progress.scheduled} voltam a sair ao retomar.`,
  });
  if (options.canSeeCosts) {
    checks.push({
      key: 'cost_used',
      status: 'ok',
      label: 'Custo já usado',
      detail:
        progress.costUsed === null
          ? 'Custo por campanha ainda não é registrado.'
          : `${progress.costUsed} até agora.`,
    });
  }
  return checks;
}

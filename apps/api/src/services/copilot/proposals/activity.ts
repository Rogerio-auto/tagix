/**
 * Atividade do Copiloto (A8; ADR-004 §7): uma VIEW sobre `copilot_action_proposals` + contagem
 * de itens, não um log paralelo. Linhas legíveis: quem pediu, quem executou, o que mudou, o
 * resultado e o Desfazer — inclusive as `blocked`, com o encaminhamento (aprovador).
 *
 * CSV (`copilot.activity.view_all`): página a página (keyset), escrito em streaming. Sem PII de
 * contato: só nomes de membros e o resumo da proposta, este ainda passado por um filtro que
 * mascara e-mail e telefone (o resumo é texto do executor e pode citar um título de negócio,
 * nunca deveria citar contato, e o filtro garante). Células começando com `= + - @` ganham `'`
 * (injeção de fórmula em planilha).
 */
import {
  copilotProposalsRepo,
  type CopilotActivityEntry,
  type CopilotPage,
  type DbTx,
} from '@hm/db';
import { CAPABILITIES, CapabilityKeySchema, type ActivityEntry } from '@hm/shared';
import type { CopilotPrincipal } from '../identity/principal';
import { loadMemberNames, toActivityEntry } from './dto';

export interface ActivityPageResult {
  readonly data: ActivityEntry[];
  readonly next_cursor: string | null;
}

export async function listActivityPage(
  tx: DbTx,
  viewer: CopilotPrincipal,
  input: {
    readonly scope: 'mine' | 'all';
    readonly cursor?: string | null;
    readonly limit?: number;
  },
  now: Date,
): Promise<{
  page: ActivityPageResult;
  raw: CopilotPage<CopilotActivityEntry>;
  names: ReadonlyMap<string, string>;
}> {
  const raw = await copilotProposalsRepo.listActivity(tx, {
    scope: input.scope,
    memberId: viewer.memberId,
    cursor: input.cursor ?? null,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  const names = await loadMemberNames(
    tx,
    raw.items.flatMap((r) => [r.requestedByMemberId, r.executedAsMemberId, r.approverMemberId]),
  );
  return {
    page: {
      data: raw.items.map((r) => toActivityEntry(r, viewer, names, now)),
      next_cursor: raw.nextCursor,
    },
    raw,
    names,
  };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export const ACTIVITY_CSV_HEADER = [
  'data',
  'origem',
  'pedido_por',
  'executado_como',
  'aprovador',
  'acao',
  'nivel',
  'status',
  'resumo',
  'itens',
  'feitos',
  'pulados',
  'falhas',
  'desfeitos',
  'motivo_bloqueio',
] as const;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Telefone pela FORMA, não pela contagem de dígitos: (país) (DDD) [9] 4 dígitos [sep] 4 dígitos.
 * Pega `+55 (11) 98888-7777`, `(11) 3333-4444`, `11988887777`, `98888-7777`. Não pega datas
 * (`2026-10-16`, `16/10/2026`, `2026-10-16T09:14`) nem valores (`R$ 1.250.000,00`, `12.500`),
 * que não têm dois blocos de 4 dígitos. As bordas `(?<!\d)`/`(?!\d)` impedem casar no meio de
 * um número maior.
 */
const PHONE_RE =
  /(?<![\d])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2}\)[\s.-]?|\d{2}[\s.-]?)?9?\d{4}[\s.-]?\d{4}(?![\d])/g;

/** Mascara e-mail e telefone em texto livre. */
export function scrubContactPii(text: string): string {
  return text.replace(EMAIL_RE, '[e-mail]').replace(PHONE_RE, '[telefone]');
}

/** Célula CSV (RFC 4180) com defesa contra fórmula. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function nameOf(id: string | null, names: ReadonlyMap<string, string>): string {
  return id ? (names.get(id) ?? 'Membro') : '';
}

export function activityCsvRow(
  row: CopilotActivityEntry,
  names: ReadonlyMap<string, string>,
): string {
  const cap = CapabilityKeySchema.safeParse(row.capability);
  const c = row.itemCounts;
  return [
    row.createdAt.toISOString(),
    row.source,
    nameOf(row.requestedByMemberId, names),
    nameOf(row.executedAsMemberId, names),
    nameOf(row.approverMemberId, names),
    cap.success ? CAPABILITIES[cap.data].label : row.capability,
    row.riskLevel,
    row.status,
    scrubContactPii(row.summary),
    c.total - c.excluded,
    c.done,
    c.skipped,
    c.failed,
    c.undone,
    row.blockedReason,
  ]
    .map(csvCell)
    .join(',');
}

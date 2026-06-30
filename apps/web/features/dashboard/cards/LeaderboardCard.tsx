'use client';

/**
 * Card de leaderboard (DASHBOARD §3.2 — ranking de produtividade dos atendentes
 * como pódio). Consome `card.value.rows` do `leaderboard_produtividade` (S02/S03):
 * cada linha traz `{ memberId, nome, avatarUrl, resolvidas, abertas, tmr_seg }`.
 *
 * Render: lista vertical (top ~5). Cada linha → posição (1/2/3 com leve destaque),
 * `<Avatar>` (foto com fallback de iniciais — §3.6), nome (truncate) e, à direita,
 * resolvidas em `font-price` + sub-linha "abertas · tmr". O 1º colocado ganha realce
 * sutil (um único destaque, sem exagero neon). Clicar abre o drawer (§2.3 / §4 —
 * nunca modal full-screen). Estado vazio convida (§2.6), sem zero enganoso.
 *
 * O parser `readLeaderboard` faz narrowing seguro (zero `any`): value malformado
 * não quebra a tela — vira lista vazia → estado convidativo.
 *
 * DS v2: zero hex; tokens semânticos; mobile full-width, linhas com alvo ≥44px.
 */
import { Avatar } from '@hm/ui';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, MetricValue } from '../types';
import { formatDuration, formatInt } from '../format';

interface LeaderboardRow {
  readonly memberId: string;
  readonly nome: string;
  readonly avatarUrl: string | null;
  readonly resolvidas: number;
  readonly abertas: number;
  readonly tmrSeg: number | null;
}

/** Lê um número de um registro arbitrário com fallback (0 quando ausente/inválido). */
function num(record: Record<string, unknown>, key: string): number {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Lê um número opcional (null preserva "sem amostra" → "—" na formatação). */
function optNum(record: Record<string, unknown>, key: string): number | null {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Lê uma string com fallback. */
function str(record: Record<string, unknown>, key: string, fallback: string): string {
  const v = record[key];
  return typeof v === 'string' && v.trim() !== '' ? v : fallback;
}

/**
 * Narrowing defensivo do `value` jsonb → linhas tipadas. Tolera value nulo, sem
 * `rows`, ou linhas malformadas (descarta o que não for objeto). Nunca lança.
 */
function readLeaderboard(value: MetricValue | null): LeaderboardRow[] {
  if (!value) return [];
  const rows = value['rows'];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r, i) => {
      const avatar = r['avatarUrl'];
      return {
        memberId: str(r, 'memberId', `row-${i}`),
        nome: str(r, 'nome', 'Sem nome'),
        avatarUrl: typeof avatar === 'string' && avatar.trim() !== '' ? avatar : null,
        resolvidas: num(r, 'resolvidas'),
        abertas: num(r, 'abertas'),
        tmrSeg: optNum(r, 'tmr_seg'),
      };
    });
}

interface LeaderboardCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function LeaderboardCard({ card, onDrill }: LeaderboardCardProps): React.JSX.Element {
  const rows = readLeaderboard(card.value).slice(0, 5);

  return (
    <button
      type="button"
      onClick={onDrill ? () => onDrill(card) : undefined}
      className={cn(
        'group flex h-full w-full flex-col rounded-lg border border-border bg-surface p-4 text-left transition-colors sm:p-5',
        onDrill && 'hover:border-border-brand',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-head text-sm font-medium text-text">{card.label}</span>
          {/* Legenda dos números à direita — clareza §2.4 (sem coluna sem rótulo). */}
          <span className="font-body text-xs text-text-low">Resolvidas · fila atual · tempo médio</span>
        </div>
        {onDrill && (
          <ArrowUpRight
            size={14}
            className="mt-0.5 text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 font-body text-sm text-text-low">Sem atividade no período.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {rows.map((row, i) => {
            const top = i === 0;
            return (
              <li
                key={row.memberId}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5',
                  // Realce do 1º lugar por PESO/fundo neutro (não por verde — o neon é
                  // exclusivo do KPI primário; regra DS "1 verde por tela").
                  top && 'bg-surface-2',
                )}
              >
                {/* Posição */}
                <span
                  className={cn(
                    'w-4 shrink-0 text-center font-price text-sm tabular-nums',
                    top ? 'text-text' : 'text-text-low',
                  )}
                >
                  {i + 1}
                </span>

                <Avatar size="sm" src={row.avatarUrl} name={row.nome} />

                <span className="min-w-0 flex-1 truncate font-body text-sm text-text-mid">
                  {row.nome}
                </span>

                {/* Métricas */}
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  <span className={cn('font-price text-sm', top ? 'text-text' : 'text-text-mid')}>
                    {formatInt(row.resolvidas)}
                  </span>
                  <span className="font-body text-xs text-text-low">
                    {formatInt(row.abertas)} abertas · {formatDuration(row.tmrSeg)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </button>
  );
}

'use client';

/**
 * RecentLeadsCard (F48-S06) — feed de **leads recentes por atividade** no estilo da
 * ChatList: avatar (foto via `<Avatar>`, fallback iniciais), nome, badge de canal,
 * preview da última mensagem e hora relativa. Cada linha navega para o contato.
 *
 * Autocontido: NÃO importa nada de `features/conversations/**` (mantém o card
 * desacoplado). Dormente até o S08 mapeá-lo no registry por `cardType: 'list'`.
 *
 * Consome o contrato:
 *   card.value = { rows: [{ contactId, nome, avatarUrl, canal, lastActivityAt, preview }] }
 *
 * UX:
 *  - §3.9 — feed/timeline com hora relativa legível.
 *  - §3.6 — forma estável; sem foto cai em iniciais (via `<Avatar>`).
 *  - §2.6 — vazio convida ("nenhum lead ativo ainda") com CTA para Contatos.
 *  - §3.5 — hover/focus sempre visíveis (focus ring nunca suprimido).
 *  - §8 (mobile) — linhas alvo ≥44px, avatar 40px, preview truncado sem overflow.
 *
 * DS v2: zero hex hardcoded, tokens semânticos.
 */

import Link from 'next/link';
import { ArrowUpRight, Inbox, Instagram, MessageCircle, Users, type LucideIcon } from 'lucide-react';
import { Avatar } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, MetricValue } from '../types';

/** Lead recente normalizado a partir do jsonb `value.rows`. */
interface LeadRow {
  readonly contactId: string;
  readonly nome: string;
  readonly avatarUrl: string | null;
  readonly canal: string;
  readonly lastActivityAt: string | null;
  readonly preview: string | null;
}

interface RecentLeads {
  readonly rows: LeadRow[];
}

/** Máximo de linhas exibidas (feed compacto). */
const MAX_ROWS = 6;

/** Coerção tolerante: string não-vazia ou `null`. */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Lê com segurança o contrato `{ rows: [...] }` de um value jsonb. Tolerante a
 * chaves ausentes/erradas — descarta linhas sem `contactId` e nunca lança.
 */
function readLeads(value: MetricValue | null): RecentLeads {
  if (!value) return { rows: [] };
  const raw = value['rows'];
  if (!Array.isArray(raw)) return { rows: [] };

  const rows: LeadRow[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const contactId = asString(row['contactId']);
    if (!contactId) continue;
    rows.push({
      contactId,
      nome: asString(row['nome']) ?? 'Contato',
      avatarUrl: asString(row['avatarUrl']),
      canal: asString(row['canal']) ?? '',
      lastActivityAt: asString(row['lastActivityAt']),
      preview: asString(row['preview']),
    });
  }
  return { rows: rows.slice(0, MAX_ROWS) };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Hora relativa compacta da última atividade ("agora", "5min", "3h", "2d") ou a
 * data curta acima de 1 semana. Vazio quando ausente/inválida (§3.9).
 */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < MINUTE) return 'agora';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

/** Ícone do canal — WhatsApp/Instagram conhecidos, fallback genérico. */
function channelIcon(canal: string): LucideIcon {
  const c = canal.toLowerCase();
  if (c.includes('insta') || c === 'ig') return Instagram;
  return MessageCircle;
}

/** Rótulo legível do canal. */
function channelLabel(canal: string): string {
  const c = canal.toLowerCase();
  if (c.includes('whats') || c === 'wa') return 'WhatsApp';
  if (c.includes('insta') || c === 'ig') return 'Instagram';
  return canal;
}

function ChannelBadge({ canal }: { canal: string }) {
  if (!canal) return null;
  const Icon = channelIcon(canal);
  const label = channelLabel(canal);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-surface px-1.5 py-0.5 font-body text-[0.625rem] font-medium leading-none text-text-mid"
      title={label}
    >
      <Icon className="size-3" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

interface RecentLeadsCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function RecentLeadsCard({ card, onDrill }: RecentLeadsCardProps) {
  const { rows } = readLeads(card.value);

  return (
    <section className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {/* Cabeçalho: rótulo + drill opcional (drawer; modal full-screen é proibido §4). */}
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-head text-sm text-text">{card.label}</h3>
        {onDrill && (
          <button
            type="button"
            onClick={() => onDrill(card)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-body text-xs text-text-low outline-none transition-colors hover:bg-surface-2 hover:text-text-mid focus-visible:bg-surface-2 focus-visible:shadow-glow-md"
          >
            Ver todos
            <ArrowUpRight className="size-3.5" aria-hidden />
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((row) => (
            <li key={row.contactId}>
              <Link
                href={`/contacts?focus=${encodeURIComponent(row.contactId)}`}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 outline-none',
                  'transition-colors hover:bg-surface-2',
                  'focus-visible:bg-surface-2 focus-visible:shadow-glow-md',
                )}
              >
                <Avatar size="md" src={row.avatarUrl} name={row.nome} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate font-head text-sm text-text">{row.nome}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ChannelBadge canal={row.canal} />
                      {relativeTime(row.lastActivityAt) && (
                        <time
                          dateTime={row.lastActivityAt ?? undefined}
                          className="font-body text-xs text-text-low"
                        >
                          {relativeTime(row.lastActivityAt)}
                        </time>
                      )}
                    </div>
                  </div>
                  <p className="truncate font-body text-xs text-text-low">
                    {row.preview ?? 'Sem mensagens'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Vazio convida (§2.6): explica e oferece o próximo passo (ver contatos). */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-pill bg-surface-3 text-text-low">
        <Inbox className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-head text-sm text-text">Nenhum lead ativo ainda</p>
        <p className="font-body text-xs text-text-low">
          Conversas recentes aparecem aqui assim que chegarem.
        </p>
      </div>
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-body text-sm text-text-mid outline-none transition-colors hover:bg-surface-2 hover:text-text focus-visible:bg-surface-2 focus-visible:shadow-glow-md"
      >
        <Users className="size-4" aria-hidden />
        Ver contatos
      </Link>
    </div>
  );
}

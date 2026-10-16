import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { subscriptionStatus } from '../lib/labels';

/**
 * Kit visual do painel de plataforma no DS 3.0 (F72-S08). Mesmo ritmo do kit de
 * Configurações da S07 (hairline antes de sombra, rótulo mono caixa-alta, número em
 * mono tabular), sem importar de outra feature. Server-safe: nada aqui tem estado.
 */

/** Rótulo de grupo em mono caixa-alta. */
export const eyebrowClass = 'font-mono text-xs font-medium uppercase tracking-widest text-text-low';

/** Controle nativo (select/date/number) no desenho do `Input` do `@hm/ui`. 16px abaixo de `sm` (iOS). */
export const controlClass =
  'h-10 w-full min-w-0 rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none ' +
  'transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 ' +
  'focus:border-brand-text focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm';

export const textareaClass =
  'w-full rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none ' +
  'placeholder:text-text-low transition-[border-color,box-shadow] duration-(--dur-base) ease-ds ' +
  'hover:border-border-2 focus:border-brand-text focus-visible:focus-ring disabled:opacity-40 sm:text-sm';

/** Caixa de seleção nativa na cor de marca de texto (legível nos dois temas). */
export const checkboxClass = 'size-4 shrink-0 accent-brand-text';

/** Rótulo acima do campo, no desenho do `Input`. */
export function FieldLabel({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 font-body text-sm font-bold text-text-mid', className)}>
      {label}
      {children}
      {hint && <span className="font-normal text-text-low">{hint}</span>}
    </label>
  );
}

export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Ação ou contagem no canto do cabeçalho. */
  action?: ReactNode;
  footer?: ReactNode;
  /** `flush`: sem respiro (listas e tabelas que encostam na borda). */
  body?: 'padded' | 'flush';
  tone?: 'default' | 'warn' | 'danger';
  className?: string;
  children?: ReactNode;
  /** `id` do título, para `aria-labelledby` da seção. */
  titleId?: string;
}

const PANEL_TONE: Record<NonNullable<PanelProps['tone']>, string> = {
  default: 'border-border',
  warn: 'border-warn/40',
  danger: 'border-danger/40',
};

/** Superfície de uma seção: hairline, sem sombra (repousa no fundo). */
export function Panel({
  title,
  description,
  icon: Icon,
  action,
  footer,
  body = 'padded',
  tone = 'default',
  className,
  children,
  titleId,
}: PanelProps) {
  const hasHeader = Boolean(title || description || action);
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn('flex min-w-0 flex-col rounded-lg border bg-surface', PANEL_TONE[tone], className)}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <Icon
                className={cn(
                  'mt-0.5 size-4.5 shrink-0',
                  tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-text-low',
                )}
                aria-hidden
              />
            )}
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="font-head text-base font-semibold tracking-[-0.01em] text-text">
                  {title}
                </h2>
              )}
              {description && <p className="mt-1 max-w-prose font-body text-sm text-text-low">{description}</p>}
            </div>
          </div>
          {action && (
            <div className={cn('flex shrink-0 items-center gap-2', !description && 'self-center')}>{action}</div>
          )}
        </header>
      )}
      {children != null && <div className={cn('min-w-0 flex-1', body === 'padded' && 'px-5 py-4')}>{children}</div>}
      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3">{footer}</footer>
      )}
    </section>
  );
}

/** Contagem discreta para o canto de um `Panel` ("3"). */
export function Count({ value, label }: { value: string; label: string }) {
  return (
    <span className="font-mono text-sm tabular-nums text-text-low">
      <span aria-hidden>{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface KpiProps {
  label: string;
  value: string;
  /** Linha de apoio sob o número. */
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'warn' | 'danger';
  /** Barra de proporção (0–1) sob o número (ex.: uso do teto). */
  meter?: number | null;
  className?: string;
}

/**
 * KPI do DS 3.0 (maquete "kpi"): rótulo pequeno, número grande em mono tabular, apoio em
 * `text-low`. O tom só aparece quando o número pede ação (não é decoração).
 */
export function Kpi({ label, value, hint, icon: Icon, tone = 'default', meter, className }: KpiProps) {
  const pct = meter == null || !Number.isFinite(meter) ? null : Math.max(0, Math.min(1, meter));
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-lg border bg-surface p-4 md:p-5',
        tone === 'danger' ? 'border-danger/40' : tone === 'warn' ? 'border-warn/40' : 'border-border',
        className,
      )}
    >
      <p className="flex items-start justify-between gap-2 font-body text-sm leading-snug text-text-low">
        <span className="min-w-0">{label}</span>
        {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />}
      </p>
      <p
        className={cn(
          'mt-2 truncate font-mono text-xl font-medium tabular-nums tracking-[-0.02em] sm:text-2xl xl:text-[1.75rem]',
          tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-text',
        )}
      >
        {value}
      </p>
      {pct !== null && (
        <span aria-hidden className="mt-3 block h-1 overflow-hidden rounded-pill bg-surface-3">
          <span
            className={cn(
              'block h-full rounded-pill',
              tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-brand-text/60',
            )}
            style={{ width: `${pct * 100}%` }}
          />
        </span>
      )}
      {hint && <p className="mt-2 font-body text-sm text-text-low">{hint}</p>}
    </div>
  );
}

/** Lista de fatos (termo à esquerda, valor à direita), separada por hairline. */
export function Facts({
  items,
}: {
  items: ReadonlyArray<{ term: string; value: ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="divide-y divide-border">
      {items.map((it) => (
        <div key={it.term} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="shrink-0 font-body text-sm text-text-low">{it.term}</dt>
          <dd
            className={cn(
              'min-w-0 truncate text-right text-sm text-text',
              it.mono ? 'font-mono tabular-nums' : 'font-body font-semibold',
            )}
          >
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Status de assinatura em palavra e tom (nunca o código cru). */
export function SubscriptionBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const s = subscriptionStatus(status);
  return (
    <Badge tone={s.tone} size={size} dot>
      {s.label}
    </Badge>
  );
}
